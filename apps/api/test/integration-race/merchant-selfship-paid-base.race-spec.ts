import { BadRequestException } from '@nestjs/common';
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
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Đơn gian hàng tự giao đối soát trên tiền khách THỰC TRẢ cho hàng (sau mã giảm giá của khách), như hàng Tubu giao hộ:
 * gian hàng chịu phần giảm, phí giao giữ nguyên. Ví dụ tính tay (phí sàn chốt trên đơn 10%):
 *
 *   A 2 × 100.000 = 200.000, B 1 × 100.000 = 100.000 → tiền hàng 300.000
 *   mã giảm giá 50.000 (Điểm Xanh không dùng cho hàng đối tác); phí giao 30.000 → khách trả 280.000
 *   tiền hàng thực trả 250.000, chia theo giá trị dòng: A 166.667, B 83.333
 *
 *   SALE        hàng 250.000, phí giao 30.000, phí sàn 25.000
 *               COD (gian hàng đã thu 280.000): 250.000 + 30.000 − 25.000 − 280.000 = −25.000 (gian hàng nộp Tubu)
 *               Ví Tubu (Tubu giữ 280.000):     250.000 + 30.000 − 25.000            = 255.000 (Tubu trả gian hàng)
 *               (nền cũ theo tiền hàng 300.000: COD +20.000, ví 300.000 — Tubu chịu 50.000 giảm giá)
 *   trả 1 × A   hàng −round(166.667 / 2) = −83.334, phí sàn −8.333 → −75.001
 *   trả nốt     đảo phần còn lại: hàng −166.666, phí giao −30.000, phí sàn −16.667 → −179.999
 *   cộng lại    hàng 0, phí giao 0, phí sàn 0; COD: −280.000 = đúng tiền mặt gian hàng giữ mà Tubu đã hoàn khách; ví: 0
 */
describe('Đối soát đơn tự giao theo tiền khách thực trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
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
    returns = moduleRef.get(OrderReturnsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup(paymentMethod: 'COD' | 'WALLET') {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    // Phí sàn của gian hàng đã đổi sau khi đặt: đơn giữ mức 10% chốt trên đơn.
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itsp-${tag}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.2 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itsp-${tag}`,
        name: `Trà ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: {
          create: [
            { sku: `ITSP-A-${tag}`, name: 'Hộp A', attributes: {}, retailPrice: 100_000, stock: 10 },
            { sku: `ITSP-B-${tag}`, name: 'Hộp B', attributes: {}, retailPrice: 100_000, stock: 10 },
          ],
        },
      },
      include: { variations: { orderBy: { sku: 'asc' } } },
    });
    const [vA, vB] = product.variations;
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      deliveredAt: ago(2),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: store.id,
      merchantCommissionPct: 0.1,
      paymentMethod,
      paymentStatus: paymentMethod === 'COD' ? 'UNPAID' : 'PAID',
      subtotal: 300_000,
      discount: 50_000,
      couponDiscount: 50_000,
      pointsDiscount: 0,
      shippingFee: 30_000,
      total: 280_000,
      items: {
        create: [
          { variationId: vA!.id, productName: 'Trà', variationName: 'Hộp A', unitPrice: 100_000, quantity: 2, total: 200_000 },
          { variationId: vB!.id, productName: 'Trà', variationName: 'Hộp B', unitPrice: 100_000, quantity: 1, total: 100_000 },
        ],
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const itemA = items.find((i) => i.variationName === 'Hộp A')!;
    const itemB = items.find((i) => i.variationName === 'Hộp B')!;
    return { store, buyer, order, itemA, itemB };
  }

  const linesOf = (orderId: string) => prisma.merchantPayoutLine.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  const sum = (rows: { [k: string]: unknown }[], k: 'goodsAmount' | 'shippingFee' | 'commissionAmount' | 'netAmount') =>
    rows.reduce((s, r) => s + (r[k] as number), 0);

  /** Hạn đổi/trả tính từ lúc giao: mở cửa sổ khi khách gửi yêu cầu, lùi qua hạn giữ khi đối soát. */
  async function requestReturn(order: { id: string; code: string }, buyerId: string, lines: { orderItemId: string; quantity: number }[]) {
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(2) } });
    const r = await returns.request(buyerId, order.code, { reasonCode: 'OTHER', reason: 'Trả hàng', items: lines });
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(10) } });
    return r;
  }

  async function lifecycle(paymentMethod: 'COD' | 'WALLET') {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { store, buyer, order, itemA, itemB } = await setup(paymentMethod);
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(10) } });

    await settlement.createPayout(admin.id, store.id);
    const [sale] = await linesOf(order.id);
    const r1 = await requestReturn(order, buyer.id, [{ orderItemId: itemA.id, quantity: 1 }]);
    await returns.review(admin.id, r1.id, { approve: true });
    await settlement.createPayout(admin.id, store.id);
    const partial = (await linesOf(order.id)).find((l) => l.refKey === `RETURN:${r1.id}`)!;

    const r2 = await requestReturn(order, buyer.id, [
      { orderItemId: itemA.id, quantity: 1 },
      { orderItemId: itemB.id, quantity: 1 },
    ]);
    await returns.review(admin.id, r2.id, { approve: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    await settlement.createPayout(admin.id, store.id);
    await expect(settlement.createPayout(admin.id, store.id)).rejects.toBeInstanceOf(BadRequestException);
    const all = await linesOf(order.id);
    return { sale: sale!, partial, whole: all.find((l) => l.kind === 'REVERSAL' && l.refKey === '')!, all, r1 };
  }

  it('COD: gian hàng nộp phí sàn trên tiền khách trả (−25.000); trả 1 × A −75.001; trả nốt −179.999; cộng lại = −280.000 tiền COD', async () => {
    const { sale, partial, whole, all } = await lifecycle('COD');
    expect(sale).toMatchObject({ kind: 'SALE', refKey: '', goodsAmount: 250_000, shippingFee: 30_000, commissionAmount: 25_000, codCollected: 280_000, netAmount: -25_000 });
    expect(partial).toMatchObject({ kind: 'REVERSAL', goodsAmount: -83_334, shippingFee: 0, commissionAmount: -8_333, codCollected: 0, netAmount: -75_001 });
    expect(whole).toMatchObject({ goodsAmount: -166_666, shippingFee: -30_000, commissionAmount: -16_667, codCollected: 0, netAmount: -179_999 });
    expect(all).toHaveLength(3);
    expect([sum(all, 'goodsAmount'), sum(all, 'shippingFee'), sum(all, 'commissionAmount')]).toEqual([0, 0, 0]);
    expect(sum(all, 'netAmount')).toBe(-280_000);
  });

  it('Ví Tubu: Tubu trả gian hàng 255.000; trả 1 × A −75.001; trả nốt −179.999; cộng lại = 0', async () => {
    const { sale, partial, whole, all } = await lifecycle('WALLET');
    expect(sale).toMatchObject({ goodsAmount: 250_000, shippingFee: 30_000, commissionAmount: 25_000, codCollected: 0, netAmount: 255_000 });
    expect(partial).toMatchObject({ goodsAmount: -83_334, commissionAmount: -8_333, netAmount: -75_001 });
    expect(whole).toMatchObject({ goodsAmount: -166_666, shippingFee: -30_000, commissionAmount: -16_667, netAmount: -179_999 });
    expect(sum(all, 'netAmount')).toBe(0);
  });

  it('phiếu lập trước khi đổi nền giữ số đã lưu; dòng đảo về sau tính trên số đã lưu (nền cũ), cộng lại vẫn = −280.000 tiền COD', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { store, buyer, order, itemA, itemB } = await setup('COD');
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(10) } });
    // Phiếu lập theo nền cũ (tiền hàng 300.000, Tubu chịu giảm giá): 300.000 + 30.000 − 30.000 − 280.000 = +20.000.
    const old = await prisma.merchantPayout.create({
      data: {
        storefrontId: store.id,
        amount: 20_000,
        bankInfo: {},
        createdBy: admin.id,
        lines: {
          create: {
            orderId: order.id,
            orderCode: order.code,
            kind: 'SALE',
            refKey: '',
            goodsAmount: 300_000,
            shippingFee: 30_000,
            commissionAmount: 30_000,
            codCollected: 280_000,
            netAmount: 20_000,
          },
        },
      },
    });
    expect((await settlement.statementFor(store.id)).lines.filter((l) => l.orderId === order.id)).toEqual([]);

    const r1 = await requestReturn(order, buyer.id, [{ orderItemId: itemA.id, quantity: 1 }]);
    await returns.review(admin.id, r1.id, { approve: true });
    // Nền cũ chia theo giá trị dòng: A 200.000 → trả 1/2 = 100.000, phí sàn 10.000.
    const st = await settlement.statementFor(store.id);
    expect(st.lines.filter((l) => l.orderId === order.id)).toEqual([
      expect.objectContaining({ kind: 'REVERSAL', refKey: `RETURN:${r1.id}`, goodsAmount: -100_000, commissionAmount: -10_000, netAmount: -90_000 }),
    ]);
    await settlement.createPayout(admin.id, store.id);

    const r2 = await requestReturn(order, buyer.id, [
      { orderItemId: itemA.id, quantity: 1 },
      { orderItemId: itemB.id, quantity: 1 },
    ]);
    await returns.review(admin.id, r2.id, { approve: true });
    await settlement.createPayout(admin.id, store.id);
    const all = await linesOf(order.id);
    expect(all.find((l) => l.kind === 'REVERSAL' && l.refKey === '')).toMatchObject({
      goodsAmount: -200_000,
      shippingFee: -30_000,
      commissionAmount: -20_000,
      netAmount: -210_000,
    });
    expect(sum(all, 'netAmount')).toBe(-280_000);
    expect((await prisma.merchantPayout.findUniqueOrThrow({ where: { id: old.id } })).amount).toBe(20_000);
  });
});
