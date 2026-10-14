import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { linkTubuFulfilledVariation } from '../../src/modules/merchant/merchant-pancake-link';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import {
  barrierOnFirstCalls,
  createOrder,
  createUser,
  randCode,
  setConfig,
  sleep,
  summarize,
  warmPool,
} from './helpers';

/**
 * Đơn đối tác tự giao (D4) trên Postgres THẬT: lập phiếu đối soát chồng nhau, hai lần duyệt "Tubu giao hộ" cùng mã Pancake,
 * đối tác gửi hàng chồng với khách/admin huỷ. Chỉ stub thông báo, điểm, hoa hồng, flash-sale, coupon.
 */
describe('Merchant fulfilment races (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let service: MerchantFulfilmentService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const notifications = { notify } as unknown as NotificationsService;
    orderStatus = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      notifications,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
    service = new MerchantFulfilmentService(
      prisma,
      orderStatus,
      notifications,
      new SystemConfigService(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function merchantStore() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: {
        type: 'MERCHANT',
        slug: `itmf-${tag}`,
        title: `Shop IT ${tag}`,
        ownerUserId: owner.id,
        commissionPct: 0.15,
      },
    });
    return { owner, store };
  }

  async function productWithVariation(data: {
    storefrontId?: string | null;
    pancakeId?: string | null;
    fulfilment?: 'TUBU' | 'MERCHANT';
    approvalStatus?: 'APPROVED' | 'PENDING_REVIEW';
    pancakeLinkCode?: string | null;
    variationPancakeId?: string | null;
  }) {
    const tag = randCode(8);
    return prisma.product.create({
      data: {
        pancakeId: data.pancakeId ?? null,
        storefrontId: data.storefrontId ?? null,
        fulfilment: data.fulfilment ?? 'TUBU',
        approvalStatus: data.approvalStatus ?? 'APPROVED',
        pancakeLinkCode: data.pancakeLinkCode ?? null,
        brand: 'IT',
        slug: `itmf-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: {
          create: {
            pancakeId: data.variationPancakeId ?? null,
            sku: `itmf-${tag}`,
            name: 'Mặc định',
            attributes: {},
            retailPrice: 100_000,
            stock: 50,
          },
        },
      },
      include: { variations: true },
    });
  }

  async function deliveredMerchantOrder(
    storefrontId: string,
    buyerId: string,
    variationId: string,
    total: number,
  ) {
    return createOrder(prisma, {
      userId: buyerId,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - 10 * 86_400_000),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: storefrontId,
      merchantCommissionPct: 0.15,
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      subtotal: total - 30_000,
      shippingFee: 30_000,
      total,
      items: {
        create: {
          variationId,
          productName: 'SP IT',
          variationName: 'Mặc định',
          unitPrice: total - 30_000,
          quantity: 1,
          total: total - 30_000,
        },
      },
    });
  }

  it('(a) 4 admin lập phiếu đối soát cùng lúc → đúng 1 phiếu, mỗi đơn đúng 1 dòng SALE, số tiền khớp bảng kê', async () => {
    const { store } = await merchantStore();
    const buyer = await createUser(prisma);
    const product = await productWithVariation({ storefrontId: store.id, fulfilment: 'MERCHANT' });
    const orders = await Promise.all(
      [130_000, 230_000, 330_000].map((t) =>
        deliveredMerchantOrder(store.id, buyer.id, product.variations[0]!.id, t),
      ),
    );
    const expected = await service.statementFor(store.id);
    expect(expected.lines).toHaveLength(3);

    const spy = barrierOnFirstCalls(service, 'statementFor', 4);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => service.createPayout(`admin-${i}`, store.id)),
    );
    spy.mockRestore();
    const s = summarize(results);

    const payouts = await prisma.merchantPayout.findMany({
      where: { storefrontId: store.id },
      include: { lines: true },
    });
    const lines = await prisma.merchantPayoutLine.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
    });
    console.log(
      '[a] fulfilled=%d rejected=%d payouts=%d lines=%d errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      payouts.length,
      lines.length,
      s.errors,
    );

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected.every((r) => r.reason instanceof ConflictException)).toBe(true);
    expect(payouts).toHaveLength(1);
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((l) => l.orderId)).size).toBe(3);
    expect(payouts[0]!.amount).toBe(expected.total);
    // COD: tiền hàng + ship − phí sàn − tiền COD đối tác đã thu = −phí sàn.
    expect(expected.total).toBe(
      -(Math.round(100_000 * 0.15) + Math.round(200_000 * 0.15) + Math.round(300_000 * 0.15)),
    );
    expect((await service.statementFor(store.id)).lines).toHaveLength(0);
  });

  it('(b) 2 sản phẩm "Tubu giao hộ" cùng mã Pancake được duyệt cùng lúc → 1 thắng, biến thể chuyển đúng 1 lần, bên thua rollback cả lần duyệt', async () => {
    const pancakeVariationId = `itmf-pv-${randCode(8)}`;
    const shell = await productWithVariation({
      pancakeId: `itmf-pp-${randCode(8)}`,
      variationPancakeId: pancakeVariationId,
    });
    const a = await merchantStore();
    const b = await merchantStore();
    const pa = await productWithVariation({
      storefrontId: a.store.id,
      fulfilment: 'MERCHANT',
      approvalStatus: 'PENDING_REVIEW',
      pancakeLinkCode: pancakeVariationId,
    });
    const pb = await productWithVariation({
      storefrontId: b.store.id,
      fulfilment: 'MERCHANT',
      approvalStatus: 'PENDING_REVIEW',
      pancakeLinkCode: pancakeVariationId,
    });

    const approve = (p: typeof pa) =>
      prisma.$transaction(async (tx) => {
        const flipped = await tx.product.updateMany({
          where: { id: p.id, approvalStatus: 'PENDING_REVIEW' },
          data: { approvalStatus: 'APPROVED' },
        });
        if (flipped.count === 0) throw new Error('đã xử lý');
        await linkTubuFulfilledVariation(tx, p);
      });
    const results = await Promise.allSettled([approve(pa), approve(pb)]);
    const s = summarize(results);

    const moved = await prisma.variation.findUniqueOrThrow({
      where: { pancakeId: pancakeVariationId },
    });
    const [ra, rb, rshell] = await Promise.all(
      [pa.id, pb.id, shell.id].map((id) =>
        prisma.product.findUniqueOrThrow({ where: { id }, include: { variations: true } }),
      ),
    );
    console.log(
      '[b] fulfilled=%d rejected=%d owner=%s errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      moved.productId,
      s.errors,
    );

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected[0]!.reason).toBeInstanceOf(ConflictException);
    const [winner, loser] = moved.productId === pa.id ? [ra, rb] : [rb, ra];
    expect(moved.productId).toBe(winner.id);
    expect(winner.approvalStatus).toBe('APPROVED');
    expect(winner.fulfilment).toBe('TUBU');
    expect(winner.variations.map((v) => v.pancakeId)).toEqual([pancakeVariationId]);
    expect(loser.approvalStatus).toBe('PENDING_REVIEW');
    expect(loser.fulfilment).toBe('MERCHANT');
    expect(loser.variations).toHaveLength(1);
    expect(loser.variations[0]!.pancakeId).toBeNull();
    expect(rshell.variations).toHaveLength(0);
    expect(rshell.isActive).toBe(false);
  });

  it('(b2) sản phẩm "Tubu giao hộ" đã duyệt, đối tác sửa nội dung → chờ duyệt lại → 2 admin duyệt lại cùng lúc: 1 thắng, biến thể Pancake vẫn ở sản phẩm, bán lại được', async () => {
    const pancakeVariationId = `itmf-pv-${randCode(8)}`;
    await productWithVariation({ pancakeId: `itmf-pp-${randCode(8)}`, variationPancakeId: pancakeVariationId });
    const { owner, store } = await merchantStore();
    const p = await productWithVariation({
      storefrontId: store.id,
      fulfilment: 'MERCHANT',
      approvalStatus: 'PENDING_REVIEW',
      pancakeLinkCode: pancakeVariationId,
    });
    const approve = () =>
      prisma.$transaction(async (tx) => {
        const flipped = await tx.product.updateMany({
          where: { id: p.id, approvalStatus: 'PENDING_REVIEW' },
          data: { approvalStatus: 'APPROVED' },
        });
        if (flipped.count === 0) throw new Error('đã xử lý');
        await linkTubuFulfilledVariation(tx, p);
      });
    await approve();

    const merchant = new MerchantService(prisma, orderStatus, { notify } as unknown as NotificationsService);
    await merchant.updateProduct(owner.id, p.id, { name: `${p.name} (mới)` });
    const pending = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(pending.approvalStatus).toBe('PENDING_REVIEW');
    expect(pending.pancakeLinkCode).toBe(pancakeVariationId);

    const results = await Promise.allSettled([approve(), approve()]);
    const s = summarize(results);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { variations: true } });
    console.log('[b2] fulfilled=%d rejected=%d status=%s errors=%j', s.fulfilled.length, s.rejected.length, after.approvalStatus, s.errors);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected.some((r) => r.reason instanceof ConflictException)).toBe(false);
    expect(after.approvalStatus).toBe('APPROVED');
    expect(after.fulfilment).toBe('TUBU');
    expect(after.variations.map((v) => v.pancakeId)).toEqual([pancakeVariationId]);
  });

  it('(c) đối tác nhập vận đơn chồng với admin huỷ đơn chưa gửi (D1) → đúng 1 bên thắng, không có đơn huỷ mang mã vận đơn', async () => {
    for (let round = 0; round < 5; round++) {
      const { owner, store } = await merchantStore();
      const buyer = await createUser(prisma);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        status: 'CONFIRMED',
        fulfiller: 'MERCHANT',
        fulfillerStorefrontId: store.id,
        paymentMethod: 'COD',
      });
      const results = await Promise.allSettled([
        service.ship(owner.id, order.id, { carrier: 'GHN', trackingCode: `GHN${round}` }),
        // Vòng lẻ cho lệnh huỷ đi sau vài ms để cả hai nhánh (gửi thắng / huỷ thắng) đều được chạy.
        sleep(round % 2 ? 4 * round : 0).then(() =>
          orderStatus.setStatus(order.id, 'CANCELLED', {
            actorType: 'ADMIN',
            actorId: 'admin-it',
            note: 'Khách đổi ý',
            expectedStatus: 'CONFIRMED',
          }),
        ),
      ]);
      const s = summarize(results);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
      console.log(
        '[c#%d] status=%s code=%s errors=%j',
        round,
        after.status,
        after.shippingCode,
        s.errors,
      );

      expect(['SHIPPING', 'CANCELLED']).toContain(after.status);
      expect(history).toHaveLength(1);
      if (after.status === 'CANCELLED') {
        expect(after.shippingCode).toBeNull();
        expect(after.shippedAt).toBeNull();
        expect(results[0]!.status).toBe('rejected');
      } else {
        expect(after.shippingCode).toBe(`GHN${round}`);
        expect(results[0]!.status).toBe('fulfilled');
      }
    }
  });
});
