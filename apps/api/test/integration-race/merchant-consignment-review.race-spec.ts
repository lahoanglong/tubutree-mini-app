import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Q8 sau review, Postgres THẬT: phí chốt theo lúc đặt đơn, chỉ trả gian hàng tiền Tubu đã thu, liên kết takeover chờ admin
 * xác nhận hàng ký gửi, mốc bắt đầu đối soát, mốc giao thiếu deliveredAt, khoá theo gian hàng khi lập/huỷ phiếu, và tổng
 * xem trước phải khớp khi lập phiếu.
 */
describe('Đối soát Tubu giao hộ — các chốt sau review (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settlement: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        MerchantFulfilmentService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.commission_pct', 0.15);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    await moduleRef?.close();
  });

  async function shop(terms: { commissionPct?: number | null; consignmentFeePct?: number; consignmentFeeFixed?: number } = {}) {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itcr-${tag}`, title: `Gian hàng ${tag}`, ownerUserId: owner.id, ...terms },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itcr-p-${tag}`,
        name: `Sản phẩm ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITCR-${tag}`, pancakeId: `itcr-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 40 } },
      },
      include: { variations: true },
    });
    return { store, product, v: product.variations[0]! };
  }

  async function link(s: Awaited<ReturnType<typeof shop>>, linkedAt: Date, extra: Record<string, unknown> = {}) {
    return prisma.merchantPancakeLink.create({
      data: { storefrontId: s.store.id, productId: s.product.id, variationId: s.v.id, linkedAt, ...extra },
    });
  }

  async function order(variationId: string, o: Record<string, unknown> & { createdAt: Date }) {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    return createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      fulfiller: 'TUBU',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      subtotal: 100_000,
      total: 100_000,
      deliveredAt: ago(10),
      ...o,
      items: { create: { variationId, productName: 'Mật ong', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } },
    });
  }

  const netOf = async (storefrontId: string, orderId: string) =>
    (await settlement.statementFor(storefrontId)).lines.filter((l) => l.orderId === orderId).map((l) => l.netAmount);

  it('đổi phí sau khi giao, trước khi lập phiếu → phiếu giữ mức lúc đặt; đơn đặt sau khi đổi dùng mức mới', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    const before = await order(s.v.id, { createdAt: ago(12) });
    await settlement.updateStoreTerms(admin.id, s.store.id, { commissionPct: 0.3, consignmentFeePct: 0.05, consignmentFeeFixed: 2_000 });
    const after = await order(s.v.id, { createdAt: new Date(), deliveredAt: ago(8) });
    expect(await prisma.storefrontTermsHistory.count({ where: { storefrontId: s.store.id } })).toBe(2);

    const payout = await settlement.createPayout(admin.id, s.store.id);
    const lines = await prisma.merchantPayoutLine.findMany({ where: { payoutId: payout.id } });
    const of = (id: string) => lines.find((l) => l.orderId === id)!;
    expect(of(before.id)).toMatchObject({ goodsAmount: 100_000, commissionAmount: 10_000, opsFeeAmount: 0, netAmount: 90_000 });
    // 100.000 − 30% − (5% + 2.000) = 63.000
    expect(of(after.id)).toMatchObject({ commissionAmount: 30_000, opsFeeAmount: 7_000, netAmount: 63_000 });
  });

  it('gian hàng theo phí sàn mặc định: admin nâng mặc định 15% → 20% sau khi giao, trước khi lập phiếu → đơn đặt trước giữ 15%, đơn đặt sau 20% (Q8 review S1)', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const config = moduleRef.get(SystemConfigService);
    const s = await shop({ commissionPct: null });
    await link(s, ago(60));
    const before = await order(s.v.id, { createdAt: ago(12) });
    expect(await netOf(s.store.id, before.id)).toEqual([85_000]);
    try {
      await config.set('merchant.commission_pct', 0.2, admin.id);
      const after = await order(s.v.id, { createdAt: new Date(), deliveredAt: ago(8) });
      const history = await prisma.storefrontTermsHistory.findMany({ where: { storefrontId: s.store.id }, orderBy: { effectiveFrom: 'asc' } });
      expect(history.map((h) => [Number(h.commissionPct), h.changedById])).toEqual([
        [0.15, null],
        [0.2, admin.id],
      ]);

      // Admin sửa phí giao hộ, gian hàng vẫn theo mặc định: dòng mới lưu 20%, không để trống.
      await settlement.updateStoreTerms(admin.id, s.store.id, { consignmentFeeFixed: 0 });
      const latest = await prisma.storefrontTermsHistory.findFirst({ where: { storefrontId: s.store.id }, orderBy: { effectiveFrom: 'desc' } });
      expect(Number(latest!.commissionPct)).toBe(0.2);

      const payout = await settlement.createPayout(admin.id, s.store.id);
      const lines = await prisma.merchantPayoutLine.findMany({ where: { payoutId: payout.id } });
      const of = (id: string) => lines.find((l) => l.orderId === id)!;
      expect(of(before.id)).toMatchObject({ goodsAmount: 100_000, commissionAmount: 15_000, netAmount: 85_000 });
      expect(of(after.id)).toMatchObject({ goodsAmount: 100_000, commissionAmount: 20_000, netAmount: 80_000 });
    } finally {
      await config.set('merchant.commission_pct', 0.15, admin.id);
    }
  });

  it('đơn công nợ đại lý (chuyển khoản, chưa trả) chưa đối soát; admin ghi nhận đã trả thì vào bảng kê', async () => {
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    const dealer = await order(s.v.id, { createdAt: ago(20), type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 80_000, subtotal: 80_000 });
    const cod = await order(s.v.id, { createdAt: ago(20), paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    expect(await netOf(s.store.id, dealer.id)).toEqual([]);
    expect(await netOf(s.store.id, cod.id)).toEqual([90_000]);
    await prisma.order.update({ where: { id: dealer.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    expect(await netOf(s.store.id, dealer.id)).toEqual([72_000]);
  });

  it('liên kết takeover: chưa xác nhận hàng ký gửi thì không đối soát; xác nhận rồi chỉ đơn đặt từ lúc xác nhận; liên kết thường tính như cũ', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const t = await shop({ commissionPct: 0.1 });
    const takeover = await link(t, ago(60), { takeover: true, stockAtLink: 37 });
    const early = await order(t.v.id, { createdAt: ago(30) });
    expect(await netOf(t.store.id, early.id)).toEqual([]);
    // Danh sách chỉ đọc "chưa vào đối soát tự động" cho đối tác và admin (Q8 review S5).
    const excludedOf = async (storefrontId: string) =>
      (await settlement.consignmentExcluded(storefrontId)).lines.map((l) => [l.orderId, l.reason, l.goodsAmount]);
    expect(await excludedOf(t.store.id)).toEqual([[early.id, 'TAKEOVER_UNCONFIRMED', 100_000]]);

    const confirmed = summarize(await Promise.allSettled([1, 2].map(() => settlement.confirmConsignment(admin.id, takeover.id))));
    expect(confirmed.rejected).toHaveLength(0);
    const row = await prisma.merchantPancakeLink.findUniqueOrThrow({ where: { id: takeover.id } });
    expect(row.consignmentConfirmedAt).not.toBeNull();
    expect(row.consignmentConfirmedBy).toBe(admin.id);
    const late = await order(t.v.id, { createdAt: new Date(row.consignmentConfirmedAt!.getTime() + 1_000), deliveredAt: ago(8) });
    expect(await netOf(t.store.id, early.id)).toEqual([]);
    expect(await netOf(t.store.id, late.id)).toEqual([90_000]);
    // R4-PARTNER-3: đã xác nhận rồi thì đơn đặt trước mốc xác nhận không còn "chờ xác nhận" (sẽ không bao giờ tự vào phiếu).
    expect(await excludedOf(t.store.id)).toEqual([[early.id, 'TAKEOVER_BEFORE_CONFIRM', 100_000]]);
    const excluded = await settlement.consignmentExcluded(t.store.id);
    expect(excluded.lines[0]!.confirmedAt?.getTime()).toBe(row.consignmentConfirmedAt!.getTime());

    const plain = await shop({ commissionPct: 0.1 });
    const plainLink = await link(plain, ago(60));
    const o = await order(plain.v.id, { createdAt: ago(30) });
    expect(await netOf(plain.store.id, o.id)).toEqual([90_000]);
    expect(await excludedOf(plain.store.id)).toEqual([]);
    await expect(settlement.confirmConsignment(admin.id, plainLink.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mốc bắt đầu đối soát giao hộ: đơn đặt trước mốc không tự vào bảng kê', async () => {
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    const old = await order(s.v.id, { createdAt: ago(30) });
    const fresh = await order(s.v.id, { createdAt: ago(15) });
    await setConfig(prisma, 'merchant.consignment_settle_from', ago(20).toISOString());
    try {
      expect(await netOf(s.store.id, old.id)).toEqual([]);
      expect(await netOf(s.store.id, fresh.id)).toEqual([90_000]);
      const excluded = await settlement.consignmentExcluded(s.store.id);
      expect(excluded.lines.map((l) => [l.orderId, l.orderItemId !== null, l.reason, l.goodsAmount])).toEqual([[old.id, true, 'BEFORE_SETTLE_FROM', 100_000]]);
      expect(excluded.total).toBe(1);
      expect(excluded.settleFrom?.getTime()).toBe(new Date((await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'merchant.consignment_settle_from' } })).value as string).getTime());
      // Mốc ghi sai (ghi thẳng DB, không qua kiểm tra lúc ghi): bảng kê không lỗi, tạm không giới hạn (Q8 review S6).
      await setConfig(prisma, 'merchant.consignment_settle_from', '2026-13-01');
      expect(await netOf(s.store.id, old.id)).toEqual([90_000]);
      await expect(settlement.adminOverview()).resolves.toBeDefined();
    } finally {
      await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    }
  });

  it('đơn đã giao thiếu deliveredAt: lấy lần chuyển DELIVERED trong sổ trạng thái, không có thì updatedAt', async () => {
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    const withHistory = await order(s.v.id, { createdAt: ago(30), deliveredAt: null });
    await prisma.orderStatusHistory.create({
      data: { orderId: withHistory.id, fromStatus: 'SHIPPING', toStatus: 'DELIVERED', actorType: 'PANCAKE', createdAt: ago(12) },
    });
    const recentHistory = await order(s.v.id, { createdAt: ago(30), deliveredAt: null });
    await prisma.orderStatusHistory.create({
      data: { orderId: recentHistory.id, fromStatus: 'SHIPPING', toStatus: 'DELIVERED', actorType: 'PANCAKE', createdAt: ago(2) },
    });
    const bare = await order(s.v.id, { createdAt: ago(30), deliveredAt: null });
    const st = await settlement.statementFor(s.store.id);
    expect(st.lines.map((l) => l.orderId)).toEqual([withHistory.id]);
    expect(st.upcoming.map((l) => l.orderId).sort()).toEqual([recentHistory.id, bare.id].sort());
  });

  it('tổng xem trước khác tổng lúc lập → từ chối, không tạo phiếu; khớp thì lập được', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    await order(s.v.id, { createdAt: ago(20) });
    await expect(settlement.createPayout(admin.id, s.store.id, undefined, 1)).rejects.toThrow('Số tiền chờ đối soát vừa thay đổi');
    expect(await prisma.merchantPayout.count({ where: { storefrontId: s.store.id } })).toBe(0);
    await expect(settlement.createPayout(admin.id, s.store.id, undefined, 90_000)).resolves.toMatchObject({ amount: 90_000 });
  });

  it('huỷ phiếu chồng lập phiếu (hàng giao hộ và hàng tự giao): không có phiếu đảo mồ côi, lập lại không kẹt P2002', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    for (let round = 0; round < 4; round++) {
      const s = await shop({ commissionPct: 0.1 });
      await link(s, ago(60));
      const consigned = await order(s.v.id, { createdAt: ago(20) });
      const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const selfShip = await createOrder(prisma, {
        userId: buyer.id,
        status: 'DELIVERED',
        deliveredAt: ago(10),
        fulfiller: 'MERCHANT',
        fulfillerStorefrontId: s.store.id,
        merchantCommissionPct: 0.1,
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        subtotal: 50_000,
        total: 50_000,
        items: { create: { variationId: s.v.id, productName: 'Hũ tự giao', variationName: 'Hũ', unitPrice: 50_000, quantity: 1, total: 50_000 } },
      });
      const p1 = await settlement.createPayout(admin.id, s.store.id);
      expect(p1.amount).toBe(90_000 + 45_000);
      await prisma.order.updateMany({ where: { id: { in: [consigned.id, selfShip.id] } }, data: { status: 'RETURNED', paymentStatus: 'REFUNDED' } });

      const raced = summarize(
        await Promise.allSettled(
          round % 2 === 0
            ? [settlement.cancelPayout(admin.id, p1.id, 'Huỷ để thử đua'), settlement.createPayout(admin.id, s.store.id)]
            : [settlement.createPayout(admin.id, s.store.id), settlement.cancelPayout(admin.id, p1.id, 'Huỷ để thử đua')],
        ),
      );
      console.log('[cancel x create #%d] errors=%j', round, raced.errors);

      const live = await prisma.merchantPayout.findMany({ where: { storefrontId: s.store.id, status: { not: 'CANCELLED' } }, include: { lines: true } });
      const lines = live.flatMap((p) => p.lines);
      // Mọi dòng đảo đều có dòng SALE tương ứng ở một phiếu còn hiệu lực.
      for (const r of lines.filter((l) => l.kind === 'REVERSAL')) {
        expect(lines.some((l) => l.kind === 'SALE' && l.orderId === r.orderId && l.orderItemId === r.orderItemId)).toBe(true);
      }
      expect(lines.reduce((sum, l) => sum + l.netAmount, 0)).toBeGreaterThanOrEqual(0);
      const after = await settlement.createPayout(admin.id, s.store.id).catch((e: unknown) => e);
      expect(after).toBeInstanceOf(BadRequestException);
      expect((await settlement.statementFor(s.store.id)).lines).toHaveLength(0);
    }
  });

  it('tổng quan admin chỉ dựng bảng kê cho gian hàng có khoản chờ: số khoản/số tiền đúng với bảng kê', async () => {
    const s = await shop({ commissionPct: 0.1 });
    await link(s, ago(60));
    await order(s.v.id, { createdAt: ago(20) });
    const idle = await shop({ commissionPct: 0.1 });
    await link(idle, ago(60));
    // Tổng quan lấy tối đa 200 gian hàng theo tên: đặt tên lên đầu để không bị gian hàng của các spec khác đẩy ra ngoài.
    await prisma.storefront.updateMany({ where: { id: { in: [s.store.id, idle.store.id] } }, data: { title: '000 Tổng quan IT' } });
    const spy = jest.spyOn(settlement, 'statementFor');
    const overview = await settlement.adminOverview();
    const mine = overview.stores.find((x) => x.storefrontId === s.store.id)!;
    expect(mine).toMatchObject({ settleableLines: 1, settleableAmount: 90_000, consignmentLines: 1 });
    expect(overview.stores.find((x) => x.storefrontId === idle.store.id)).toMatchObject({ settleableLines: 0, settleableAmount: 0 });
    const called = new Set(spy.mock.calls.map((c) => c[0]));
    expect(called.has(s.store.id)).toBe(true);
    expect(called.has(idle.store.id)).toBe(false);
    spy.mockRestore();
    await expect(settlement.createPayout('x', idle.store.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(settlement.cancelPayout('x', 'khong-co', 'Không có phiếu')).rejects.toBeInstanceOf(ConflictException);
  });
});
