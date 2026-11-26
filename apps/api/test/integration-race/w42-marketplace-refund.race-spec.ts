import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { NO_PARTIAL_RETURNS } from '../../src/modules/orders/return-ledger';
import { WALLET_DESTINATION } from '../../src/modules/orders/refund-destination';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createOrder, pinConfig, randCode, summarize, warmPool } from './helpers';
import { cartWithLines, lotsOf, userWithLots, w42Module } from './w42-helpers';

/**
 * W42: hoàn điểm sàn khi huỷ/trả. Mỗi lô hoàn không quá phần lô đó đã dùng, đúng một lần dù nhiều đường chạy chồng (khách huỷ hai lần,
 * reverseOrderPoints của admin/webhook, duyệt trả một phần lặp lại); `points_transactions_marketplace_refund_unique` là lớp chặn cuối.
 */
describe('W42: hoàn điểm sàn khi huỷ và trả một phần (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let orders: OrdersService;
  let loyalty: LoyaltyService;
  let reversal: OrderReversalService;
  let cart: CartService;
  const touched: string[] = [];
  const restore: (() => Promise<void>)[] = [];
  const expiresAt = () => new Date(Date.now() + 365 * 864e5);

  beforeAll(async () => {
    moduleRef = await w42Module();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    orders = moduleRef.get(OrdersService);
    loyalty = moduleRef.get(LoyaltyService);
    reversal = moduleRef.get(OrderReversalService);
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

  /** Đơn đã giao tiêu `used` điểm sàn, ghi sổ và trừ số dư như CheckoutService.placeOrder. */
  async function deliveredOrderSpendingMarketplace(userId: string, used: number) {
    const order = await createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: new Date(), pointsUsed: used, pointsUsedMarketplace: used });
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: -used, lot: 'MARKETPLACE', reason: `ORDER_REDEEM_MARKETPLACE:${order.code}`, refType: 'ORDER', refId: order.id },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsMarketplaceBalance: { decrement: used } } }),
    ]);
    return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  it('khách huỷ ×2 + reverseOrderPoints ×2 cùng lúc → ORDER_REFUND_MARKETPLACE đúng một dòng, có hạn, đúng phần đã dùng', async () => {
    const u = await userWithLots(prisma, { marketplace: 20_000, standard: 50_000 }, touched);
    const { addr } = await cartWithLines(prisma, cart, u.id, 1);
    const placed = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 20_000 } as never)) as { id: string; code: string };
    const row = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(row).toMatchObject({ pointsUsed: 20_000, pointsUsedMarketplace: 20_000 });

    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      orders.cancel(u.id, placed.code),
      loyalty.reverseOrderPoints(placed.id),
      orders.cancel(u.id, placed.code),
      loyalty.reverseOrderPoints(placed.id),
    ]);
    const s = summarize(results);
    console.log('[w42-refund] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(s.rejected).toHaveLength(0);
    const refunds = await prisma.pointsTransaction.findMany({ where: { refId: placed.id, delta: { gt: 0 } } });
    expect(refunds.map((r) => [r.reason.split(':')[0], r.lot, r.delta])).toEqual([['ORDER_REFUND_MARKETPLACE', 'MARKETPLACE', 20_000]]);
    expect(refunds[0]!.expiresAt).toBeInstanceOf(Date);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 50_000, pointsConvertedBalance: 0, pointsMarketplaceBalance: 20_000 });
  });

  it('duyệt trả một phần lặp lại song song cùng yêu cầu → RETURN_REFUND_MARKETPLACE đúng một dòng; đảo cả đơn sau đó chỉ hoàn phần còn lại', async () => {
    const u = await userWithLots(prisma, { marketplace: 20_000 }, touched);
    const order = await deliveredOrderSpendingMarketplace(u.id, 20_000);
    const requestId = `it-w42-rr-${randCode(8)}`;
    const shares = {
      isFull: false,
      goods: 0,
      shipping: 0,
      pointsUsedBack: 8_000,
      convertedBack: 0,
      marketplaceBack: 8_000,
      pointsEarnedBack: 0,
      ratioBefore: 0,
      ratioAfter: 0.4,
      lines: [],
    };
    const runs = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        prisma.$transaction((tx) =>
          reversal.reversePartialReturn(tx, order, { requestId, shares, destination: WALLET_DESTINATION, prior: NO_PARTIAL_RETURNS, standardPointsExpiresAt: expiresAt() }),
        ),
      ),
    );
    expect(summarize(runs).rejected).toHaveLength(0);
    const partial = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: `RETURN_REFUND_MARKETPLACE:${order.code}` } });
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ lot: 'MARKETPLACE', delta: 8_000, refType: 'RETURN_REQUEST', refId: requestId });
    expect(partial[0]!.expiresAt).toBeInstanceOf(Date);
    expect(await lotsOf(prisma, u.id)).toMatchObject({ pointsMarketplaceBalance: 8_000 });

    // Yêu cầu đã duyệt ghi phần lô sàn đã trả: lần đảo cả đơn chỉ hoàn 20.000 − 8.000.
    await prisma.returnRequest.create({
      data: { id: requestId, orderId: order.id, userId: u.id, reason: 'IT', status: 'APPROVED', fullReturn: false, pointsRefunded: 8_000, marketplacePointsRefunded: 8_000 },
    });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, order, { standardPointsExpiresAt: expiresAt() }));
    const full = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: `ORDER_REFUND_MARKETPLACE:${order.code}` } });
    expect(full.map((r) => [r.lot, r.delta])).toEqual([['MARKETPLACE', 12_000]]);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 20_000 });
    // Chạy lại lần đảo cả đơn (webhook lặp): khoá unique chặn hoàn lần hai.
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, order, { standardPointsExpiresAt: expiresAt() }));
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, reason: `ORDER_REFUND_MARKETPLACE:${order.code}` } })).toBe(1);
    expect(await lotsOf(prisma, u.id)).toMatchObject({ pointsMarketplaceBalance: 20_000 });
  });

  it('khoá unique ở DB: ghi tay dòng hoàn điểm sàn thứ hai cùng (reason, refId) bị chặn', async () => {
    const u = await userWithLots(prisma, { marketplace: 1 }, touched);
    const data = { userId: u.id, delta: 0, lot: 'MARKETPLACE' as const, reason: `ORDER_REFUND_MARKETPLACE:IT${randCode(6)}`, refType: 'ORDER', refId: `it-${randCode(8)}` };
    await prisma.pointsTransaction.create({ data });
    await expect(prisma.pointsTransaction.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });
});
