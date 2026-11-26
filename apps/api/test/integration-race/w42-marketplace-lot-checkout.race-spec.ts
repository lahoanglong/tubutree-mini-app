import { BadRequestException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { pinConfig, summarize, warmPool } from './helpers';
import { barrierOnGetCart, cartWithLines, lotsOf, userWithLots, w42Module } from './w42-helpers';

/**
 * W42: đặt đơn tiêu lô MARKETPLACE (điểm tích từ đơn sàn) chạy chồng nhau trên Postgres thật. Lô này chung trần max_redeem_pct với lô
 * STANDARD (đơn 100.000đ, trần 20% = 20.000 điểm ở 1 điểm = 1đ). Bất biến: không lô nào âm, số dư từng lô == tổng sổ lô đó.
 */
describe('W42: checkout tiêu lô MARKETPLACE dưới tải song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  const touched: string[] = [];
  const restore: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    moduleRef = await w42Module();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
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

  it('5 đơn song song, mỗi đơn cần 20.000 điểm sàn, số dư chỉ đủ 2 → đúng 2 đơn, lô không âm, câu lỗi nói về điểm sàn', async () => {
    const u = await userWithLots(prisma, { marketplace: 50_000 }, touched);
    const { addr, lineIds } = await cartWithLines(prisma, cart, u.id, 5);
    const spy = barrierOnGetCart(cart, 5);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        lineIds.map((id) => checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 20_000, itemIds: [id] } as never)),
      );
    } finally {
      spy.mockRestore();
    }
    const s = summarize(results);
    console.log('[w42-checkout] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(s.fulfilled).toHaveLength(2);
    for (const r of s.rejected) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as Error).message).toContain('Điểm Xanh tích từ đơn sàn của bạn đã thay đổi');
    }
    const placed = await prisma.order.findMany({ where: { userId: u.id } });
    expect(placed).toHaveLength(2);
    expect(placed.every((o) => o.pointsUsed === 20_000 && o.pointsUsedMarketplace === 20_000 && o.pointsUsedConverted === 0)).toBe(true);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 10_000 });
    const redeem = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: { startsWith: 'ORDER_REDEEM' } } });
    expect(redeem.map((r) => [r.reason.split(':')[0], r.lot, r.delta, r.refType])).toEqual([
      ['ORDER_REDEEM_MARKETPLACE', 'MARKETPLACE', -20_000, 'ORDER'],
      ['ORDER_REDEEM_MARKETPLACE', 'MARKETPLACE', -20_000, 'ORDER'],
    ]);
  });

  it('ba lô: điểm sàn trước, điểm thường tới trần chung 20%, phần còn lại từ lô quy đổi; báo giá và đơn khớp nhau', async () => {
    const u = await userWithLots(prisma, { marketplace: 15_000, standard: 100_000, converted: 10_000 }, touched);
    const { addr } = await cartWithLines(prisma, cart, u.id, 1);
    const quote = (await checkout.quote(u.id, { addressId: addr.id, pointsToUse: 40_000 } as never)) as unknown as Record<string, number>;
    expect(quote).toMatchObject({ pointsUsed: 30_000, pointsUsedMarketplace: 15_000, pointsUsedConverted: 10_000, pointsMarketplaceBalance: 15_000, redeemableMarketplacePoints: 15_000 });
    const order = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 40_000 } as never);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: (order as { id: string }).id } });
    expect(row).toMatchObject({ pointsUsed: 30_000, pointsUsedMarketplace: 15_000, pointsUsedConverted: 10_000 });
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 95_000, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0 });
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: u.id, refId: row.id }, orderBy: { reason: 'asc' } });
    expect(rows.map((r) => [r.reason.split(':')[0], r.lot, r.delta])).toEqual([
      ['ORDER_REDEEM', 'STANDARD', -5_000],
      ['ORDER_REDEEM_CONVERTED', 'CONVERTED', -10_000],
      ['ORDER_REDEEM_MARKETPLACE', 'MARKETPLACE', -15_000],
    ]);
  });
});
