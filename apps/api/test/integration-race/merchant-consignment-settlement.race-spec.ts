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
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Q8 trên Postgres THẬT: hàng "Tubu giao hộ" (biến thể Pancake liên kết với gian hàng) đối soát qua CÙNG phiếu với hàng tự
 * giao, mỗi dòng hàng một dòng phiếu (refKey ITEM:<dòng>). Ví dụ tính tay (khớp merchant-consignment.spec.ts): phí sàn 10%,
 * phí giao hộ 2% + 3.400đ/đơn; đơn A 2×60.000 + B 50.000 (giao hộ) + C 30.000 (hàng Tubu), mã giảm 30.000,
 * phí giao 25.000 → khách trả 195.000, tiền hàng thực trả 170.000.
 *   SALE A = 102.000 − 10.200 − 4.440 = 87.360; SALE B = 42.500 − 4.250 − 1.850 = 36.400; phiếu 123.760.
 *   Trả 1 hũ A: REVERSAL −51.000 + 5.100 + 2.220 = −43.680 (khách được hoàn 51.000).
 */
describe('Đối soát hàng Tubu giao hộ qua phiếu đối soát (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let status: OrderStatusService;
  let settlement: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
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
    await setConfig(prisma, 'returns.window_days', 7);
    // Các ca ở đây dùng đơn đặt lùi ngày; mốc bắt đầu đối soát giao hộ (= lúc triển khai) có ca riêng ở spec review.
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    returns = moduleRef.get(OrderReturnsService);
    status = moduleRef.get(OrderStatusService);
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function shop(terms: { commissionPct?: number | null; consignmentFeePct?: number; consignmentFeeFixed?: number } = {}) {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itcs-${tag}`, title: `Vườn giao hộ ${tag}`, ownerUserId: owner.id, ...terms },
    });
    return { owner, store, tag };
  }

  async function variations(storefrontId: string | null, tag: string, prices: number[]) {
    const product = await prisma.product.create({
      data: {
        storefrontId,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itcs-p-${tag}-${randCode(4).toLowerCase()}`,
        name: `Sản phẩm ${tag}`,
        description: 'IT',
        basePrice: prices[0]!,
        variations: {
          create: prices.map((p, i) => ({
            sku: `ITCS-${tag}-${i}-${randCode(4)}`,
            pancakeId: `itcs-${tag}-${i}-${randCode(4)}`,
            name: `Loại ${i}`,
            attributes: {},
            retailPrice: p,
            stock: 20,
          })),
        },
      },
      include: { variations: { orderBy: { retailPrice: 'desc' } } },
    });
    return { product, variations: product.variations };
  }

  async function link(storefrontId: string, productId: string, variationId: string, linkedAt: Date, unlinkedAt: Date | null = null) {
    await prisma.merchantPancakeLink.create({ data: { storefrontId, productId, variationId, linkedAt, unlinkedAt } });
  }

  async function consignmentOrder(
    buyerId: string,
    lines: { variationId: string; name: string; unitPrice: number; quantity: number }[],
    o: { createdAt: Date; status?: 'DELIVERED' | 'SHIPPING' | 'CANCELLED'; deliveredAt?: Date | null; discount?: number; shippingFee?: number } & Record<string, unknown>,
  ) {
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const { discount = 0, shippingFee = 0, ...rest } = o;
    const order = await createOrder(prisma, {
      userId: buyerId,
      status: 'DELIVERED',
      fulfiller: 'TUBU',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      subtotal,
      discount,
      shippingFee,
      total: subtotal - discount + shippingFee,
      ...rest,
      items: {
        create: lines.map((l) => ({
          variationId: l.variationId,
          productName: l.name,
          variationName: 'Loại',
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          total: l.unitPrice * l.quantity,
        })),
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const itemOf = (variationId: string) => items.find((i) => i.variationId === variationId)!;
    return { order, itemOf };
  }

  const linesOf = (orderId: string) => prisma.merchantPayoutLine.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { refKey: 'asc' }] });
  const walletOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalance;
  const stockOf = async (id: string) => (await prisma.variation.findUniqueOrThrow({ where: { id } })).stock;
  const sum = (ls: { netAmount: number }[]) => ls.reduce((s, l) => s + l.netAmount, 0);

  it('ví dụ tính tay: 2 dòng giao hộ + 1 dòng Tubu + mã giảm → đúng 2 dòng SALE 87.360/36.400 dù lập phiếu chồng; trả 1 hũ A chồng lập phiếu → đúng 1 REVERSAL −43.680; trả nốt → đơn RETURNED, tổng các dòng = 0', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { owner, store, tag } = await shop({ commissionPct: 0.1, consignmentFeePct: 0.02, consignmentFeeFixed: 3_400 });
    const { product, variations: [vA, vB] } = await variations(store.id, tag, [60_000, 50_000]);
    const { variations: [vC] } = await variations(null, `${tag}t`, [30_000]);
    await link(store.id, product.id, vA!.id, ago(60));
    await link(store.id, product.id, vB!.id, ago(60));
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const { order, itemOf } = await consignmentOrder(
      buyer.id,
      [
        { variationId: vA!.id, name: 'Mật ong', unitPrice: 60_000, quantity: 2 },
        { variationId: vB!.id, name: 'Xà bông', unitPrice: 50_000, quantity: 1 },
        { variationId: vC!.id, name: 'Nước rửa chén', unitPrice: 30_000, quantity: 1 },
      ],
      { createdAt: ago(3), deliveredAt: ago(2), discount: 30_000, couponDiscount: 30_000, pointsDiscount: 0, shippingFee: 25_000 },
    );
    expect(order.total).toBe(195_000);
    const iA = itemOf(vA!.id);
    const iB = itemOf(vB!.id);

    // Chưa đủ 7 ngày: chỉ ở "Sắp đủ hạn", có ngày đối soát; chưa lập phiếu được.
    const early = await settlement.statementFor(store.id);
    expect(early.lines).toHaveLength(0);
    expect(early.upcoming.map((l) => [l.refKey, l.netAmount, l.availableAt !== null])).toEqual([
      [`ITEM:${iA.id}`, 87_360, true],
      [`ITEM:${iB.id}`, 36_400, true],
    ]);
    await expect(settlement.createPayout(admin.id, store.id)).rejects.toBeInstanceOf(BadRequestException);

    const r1 = await returns.request(buyer.id, order.code, { reasonCode: 'OTHER', reason: 'Một hũ bị nứt', items: [{ orderItemId: iA.id, quantity: 1 }] });
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(10) } });

    const first = summarize(await Promise.allSettled([1, 2, 3].map((i) => settlement.createPayout(`admin-${i}`, store.id))));
    console.log('[consignment x3] errors=%j', [...new Set(first.errors)]);
    expect(first.fulfilled).toHaveLength(1);
    const payout1 = first.fulfilled[0]!.value;
    expect(payout1.amount).toBe(123_760);
    const sales = await linesOf(order.id);
    expect(sales.map((l) => [l.kind, l.refKey, l.orderItemId, l.goodsAmount, l.shippingFee, l.commissionAmount, l.opsFeeAmount, l.codCollected, l.netAmount])).toEqual([
      ['SALE', `ITEM:${iA.id}`, iA.id, 102_000, 0, 10_200, 4_440, 0, 87_360],
      ['SALE', `ITEM:${iB.id}`, iB.id, 42_500, 0, 4_250, 1_850, 0, 36_400],
    ]);

    // Duyệt trả 1 hũ A chồng với 3 lần lập phiếu: đúng một dòng đảo, ở đúng một phiếu.
    const preview = await returns.preview(r1.id);
    expect(preview.returnTo.kind).toBe('TUBU');
    expect(preview.refund).toBe(51_000);
    const raced = summarize(
      await Promise.allSettled([
        returns.review(admin.id, r1.id, { approve: true, expectedRefund: preview.refund }),
        settlement.createPayout('admin-a', store.id),
        settlement.createPayout('admin-b', store.id),
        settlement.createPayout('admin-c', store.id),
      ]),
    );
    console.log('[consignment partial x4] errors=%j', [...new Set(raced.errors)]);
    await settlement.createPayout('admin-it', store.id).catch((e: unknown) => expect(e).toBeInstanceOf(BadRequestException));
    const partial = (await linesOf(order.id)).filter((l) => l.kind === 'REVERSAL');
    expect(partial.map((l) => [l.refKey, l.orderItemId, l.goodsAmount, l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      [`RETURN:${r1.id}:ITEM:${iA.id}`, iA.id, -51_000, -5_100, -2_220, -43_680],
    ]);
    expect(await walletOf(buyer.id)).toBe(51_000);
    expect((await settlement.statementFor(store.id)).lines).toHaveLength(0);

    // Hàng trả về kho Tubu/Pancake: gian hàng không xác nhận nhận hàng được, admin kho Tubu cộng kho.
    const stock0 = await stockOf(vA!.id);
    await expect(returns.markReceivedByMerchant(owner.id, r1.id)).rejects.toThrow();
    await returns.markReceived(admin.id, r1.id);
    expect(await stockOf(vA!.id)).toBe(stock0 + 1);

    // Trả nốt mọi thứ còn lại: đơn RETURNED, mỗi dòng giao hộ một REVERSAL ITEM:<dòng> chỉ phần còn lại.
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(2) } });
    const r2 = await returns.request(buyer.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Trả nốt',
      items: [
        { orderItemId: iA.id, quantity: 1 },
        { orderItemId: iB.id, quantity: 1 },
        { orderItemId: itemOf(vC!.id).id, quantity: 1 },
      ],
    });
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(10) } });
    await returns.review(admin.id, r2.id, { approve: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    expect(await walletOf(buyer.id)).toBe(195_000);

    await Promise.allSettled([settlement.createPayout('admin-d', store.id), settlement.createPayout('admin-e', store.id)]);
    const all = await linesOf(order.id);
    console.log('[consignment final] %j', all.map((l) => [l.kind, l.refKey, l.netAmount]));
    expect(all.filter((l) => l.kind === 'REVERSAL' && l.refKey.startsWith('ITEM:')).map((l) => [l.refKey, l.netAmount]).sort()).toEqual(
      [
        [`ITEM:${iA.id}`, -43_680],
        [`ITEM:${iB.id}`, -36_400],
      ].sort(),
    );
    expect(new Set(all.map((l) => `${l.kind}|${l.refKey}`)).size).toBe(all.length);
    expect(all.every((l) => l.orderItemId !== itemOf(vC!.id).id)).toBe(true);
    expect(sum(all)).toBe(0);
    expect(all.reduce((s, l) => s + l.goodsAmount, 0)).toBe(0);
    expect(all.reduce((s, l) => s + l.commissionAmount + l.opsFeeAmount, 0)).toBe(0);
    expect((await settlement.statementFor(store.id)).lines).toHaveLength(0);
  });

  it('khoảng liên kết lúc đặt đơn: đơn đã giao từ trước mà chưa có dòng vẫn vào bảng kê, đúng gian hàng của lúc đặt; đơn trước liên kết hay đã huỷ thì không', async () => {
    const s1 = await shop({ commissionPct: 0.1 });
    const s2 = await shop();
    const { product, variations: [v] } = await variations(s1.store.id, s1.tag, [100_000]);
    await link(s1.store.id, product.id, v!.id, ago(60), ago(30));
    await link(s2.store.id, product.id, v!.id, ago(30));
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const line = [{ variationId: v!.id, name: 'Trà', unitPrice: 100_000, quantity: 1 }];
    const old = await consignmentOrder(buyer.id, line, { createdAt: ago(45), deliveredAt: ago(40), shippingFee: 20_000 });
    const recent = await consignmentOrder(buyer.id, line, { createdAt: ago(20), deliveredAt: ago(15), paymentMethod: 'COD' });
    const beforeLink = await consignmentOrder(buyer.id, line, { createdAt: ago(70), deliveredAt: ago(65) });
    const cancelled = await consignmentOrder(buyer.id, line, { createdAt: ago(20), status: 'CANCELLED', deliveredAt: null, paymentStatus: 'REFUNDED' });

    const [st1, st2] = await Promise.all([settlement.statementFor(s1.store.id), settlement.statementFor(s2.store.id)]);
    expect(st1.lines.map((l) => [l.orderId, l.netAmount])).toEqual([[old.order.id, 90_000]]);
    // Gian hàng không đặt phí sàn riêng: merchant.commission_pct 15%; COD do hãng thu cho Tubu nên không trừ COD.
    expect(st2.lines.map((l) => [l.orderId, l.goodsAmount, l.commissionAmount, l.codCollected, l.netAmount])).toEqual([
      [recent.order.id, 100_000, 15_000, 0, 85_000],
    ]);

    const raced = summarize(
      await Promise.allSettled([
        settlement.createPayout('admin-1', s1.store.id),
        settlement.createPayout('admin-2', s1.store.id),
        settlement.createPayout('admin-3', s2.store.id),
        settlement.createPayout('admin-4', s2.store.id),
      ]),
    );
    expect(raced.fulfilled).toHaveLength(2);
    await expect(settlement.createPayout('admin-5', s1.store.id)).rejects.toBeInstanceOf(BadRequestException);
    for (const o of [beforeLink, cancelled]) expect(await linesOf(o.order.id)).toHaveLength(0);
    expect((await linesOf(old.order.id)).map((l) => l.netAmount)).toEqual([90_000]);
    expect((await linesOf(recent.order.id)).map((l) => l.netAmount)).toEqual([85_000]);
  });

  it('webhook "Đã giao" bắn chồng → mỗi dòng hàng đúng 1 SALE; Pancake "Đã hoàn" sau khi đối soát → REVERSAL ITEM:<dòng>; không huỷ được phiếu SALE khi dòng đảo đã ở phiếu khác', async () => {
    const { store, tag } = await shop({ commissionPct: 0.2, consignmentFeeFixed: 10_000 });
    const { product, variations: [vA, vB] } = await variations(store.id, tag, [80_000, 40_000]);
    await link(store.id, product.id, vA!.id, ago(30));
    await link(store.id, product.id, vB!.id, ago(30));
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const { order, itemOf } = await consignmentOrder(
      buyer.id,
      [
        { variationId: vA!.id, name: 'Gạo', unitPrice: 80_000, quantity: 1 },
        { variationId: vB!.id, name: 'Muối', unitPrice: 40_000, quantity: 1 },
      ],
      { createdAt: ago(1), status: 'SHIPPING', deliveredAt: null, shippingFee: 30_000, paymentMethod: 'COD', paymentStatus: 'UNPAID' },
    );
    const delivered = summarize(
      await Promise.allSettled([1, 2, 3, 4].map(() => status.setStatus(order.id, 'DELIVERED', { actorType: 'PANCAKE' }))),
    );
    expect(delivered.rejected).toHaveLength(0);
    expect((await settlement.statementFor(store.id)).upcoming).toHaveLength(2);
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(9) } });

    // 120.000 tiền hàng; phí sàn 20%; phí cố định 10.000 chia 2:1 → A 80.000 − 16.000 − 6.667 = 57.333; B 40.000 − 8.000 − 3.333 = 28.667.
    const paid = summarize(await Promise.allSettled([1, 2, 3].map((i) => settlement.createPayout(`admin-${i}`, store.id))));
    expect(paid.fulfilled).toHaveLength(1);
    const salePayout = paid.fulfilled[0]!.value;
    expect((await linesOf(order.id)).map((l) => [l.refKey, l.netAmount])).toEqual([
      [`ITEM:${itemOf(vA!.id).id}`, 57_333],
      [`ITEM:${itemOf(vB!.id).id}`, 28_667],
    ]);

    await status.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE', note: 'Pancake: hàng đã hoàn về kho', returnedToSender: true });
    const back = summarize(await Promise.allSettled([1, 2].map((i) => settlement.createPayout(`admin-r${i}`, store.id))));
    expect(back.fulfilled).toHaveLength(1);
    expect(back.fulfilled[0]!.value.amount).toBe(-86_000);
    const all = await linesOf(order.id);
    expect(all.filter((l) => l.kind === 'REVERSAL').map((l) => l.refKey).sort()).toEqual(
      [`ITEM:${itemOf(vA!.id).id}`, `ITEM:${itemOf(vB!.id).id}`].sort(),
    );
    expect(sum(all)).toBe(0);
    await expect(settlement.cancelPayout('admin-x', salePayout.id, 'Thử huỷ phiếu có SALE đã bị đảo')).rejects.toBeInstanceOf(ConflictException);
  });
});
