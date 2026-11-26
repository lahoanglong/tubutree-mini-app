import { BadRequestException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { pinConfig, summarize, warmPool } from './helpers';
import { cartWithLines, lotsOf, userWithLots, w42Module } from './w42-helpers';

/**
 * W42: khách huỷ đơn đã tiêu điểm sàn (hoàn về lô MARKETPLACE trong tx huỷ) chạy chồng với lần đặt đơn khác cũng tiêu điểm sàn. Hoàn đúng
 * một lần, về đúng lô, có hạn; lần đặt chồng chỉ tiêu được số đã có lúc giữ khoá dòng user; không lô nào âm, sổ khớp số dư.
 */
describe('W42: huỷ đơn hoàn điểm sàn chồng với đặt đơn tiêu điểm sàn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let orders: OrdersService;
  let cart: CartService;
  const touched: string[] = [];
  const restore: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    moduleRef = await w42Module();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    orders = moduleRef.get(OrdersService);
    cart = moduleRef.get(CartService);
    restore.push(await pinConfig(prisma, 'loyalty.vnd_per_point_redeem', 1));
    restore.push(await pinConfig(prisma, 'loyalty.max_redeem_pct', 0.2));
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    for (const r of restore.reverse()) await r();
    await moduleRef?.close();
  });

  it.each([1, 2, 3])('vòng %d: huỷ ×2 + đặt đơn mới cùng lúc → hoàn điểm sàn đúng một lần, đơn mới tiêu đúng số đang có, không âm', async () => {
    const u = await userWithLots(prisma, { marketplace: 30_000 }, touched);
    const { addr, lineIds } = await cartWithLines(prisma, cart, u.id, 2);
    const first = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 20_000, itemIds: [lineIds[0]!] } as never)) as { id: string; code: string };
    expect(await lotsOf(prisma, u.id)).toMatchObject({ pointsMarketplaceBalance: 10_000 });

    const results = await Promise.allSettled([
      orders.cancel(u.id, first.code),
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 20_000, itemIds: [lineIds[1]!] } as never),
      orders.cancel(u.id, first.code),
    ]);
    const s = summarize(results);
    console.log('[w42-reverse] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[2]!.status).toBe('fulfilled');

    const refunds = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: `ORDER_REFUND_MARKETPLACE:${first.code}` } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ lot: 'MARKETPLACE', delta: 20_000, refType: 'ORDER', refId: first.id });
    expect(refunds[0]!.expiresAt).toBeInstanceOf(Date);
    // Điểm sàn không bao giờ hoàn thành điểm thường.
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, lot: 'STANDARD' } })).toBe(0);

    const second = await prisma.order.findFirst({ where: { userId: u.id, id: { not: first.id } } });
    const used = second?.pointsUsedMarketplace ?? 0;
    if (second) expect(used === 10_000 || used === 20_000).toBe(true);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 30_000 - used });
  });
});
