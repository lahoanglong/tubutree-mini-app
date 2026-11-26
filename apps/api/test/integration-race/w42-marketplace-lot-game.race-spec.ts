import { BadRequestException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { MARKETPLACE_POINTS_ORDER_ONLY_NOTE } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { GameService } from '../../src/modules/game/game.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { pinConfig, randCode, summarize, warmPool } from './helpers';
import { cartWithLines, lotsOf, userWithLots, w42Module } from './w42-helpers';

/**
 * W42: điểm sàn (lô MARKETPLACE) chỉ dùng khi mua hàng. Khách chỉ có điểm sàn: quay thưởng, góp quỹ cây, đổi quà đều 400 và câu báo nói
 * rõ điểm sàn chỉ dùng khi mua hàng; một đơn chạy chồng vẫn tiêu được điểm sàn. Không dòng sổ nào ngoài ORDER_REDEEM_MARKETPLACE chạm lô.
 */
describe('W42: điểm sàn không vào vòng quay, cây, đổi quà (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let game: GameService;
  let loyalty: LoyaltyService;
  const touched: string[] = [];
  const restore: (() => Promise<void>)[] = [];
  const giftId = `it-w42-gift-${randCode(8).toLowerCase()}`;

  beforeAll(async () => {
    moduleRef = await w42Module();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    game = moduleRef.get(GameService);
    loyalty = moduleRef.get(LoyaltyService);
    restore.push(await pinConfig(prisma, 'loyalty.vnd_per_point_redeem', 1));
    restore.push(await pinConfig(prisma, 'loyalty.max_redeem_pct', 0.2));
    restore.push(await pinConfig(prisma, 'game.spin_buy_cost_points', 10));
    restore.push(await pinConfig(prisma, 'game.spin_buy_daily_limit', 5));
    restore.push(await pinConfig(prisma, 'game.spin_prizes', [{ id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 }]));
    restore.push(await pinConfig(prisma, 'game.tree_points_price', 50));
    // Quà riêng không giới hạn kho: suite khác đổi quà có sẵn tới hết kho thì lỗi "đã hết" che mất lỗi thiếu điểm.
    await prisma.wasteGift.create({
      data: { id: giftId, kind: 'VOUCHER', name: 'IT W42', pointsCost: 100, status: 'ACTIVE', stock: null, voucherType: 'FREESHIP', voucherValue: 0, voucherMinOrder: 0, voucherValidDays: 30 },
    });
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await prisma.wasteGiftRedemption.deleteMany({ where: { giftId } });
    await prisma.wasteGift.deleteMany({ where: { id: giftId } });
    for (const r of restore.reverse()) await r();
    await moduleRef?.close();
  });

  const noteOf = async (p: Promise<unknown>) => {
    const e = await p.then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as Error).message;
  };

  it('chỉ có điểm sàn: quay, góp cây, đổi quà đều 400 kèm câu "chỉ dùng khi mua hàng"; số dư không đổi', async () => {
    const u = await userWithLots(prisma, { marketplace: 1_000 }, touched);
    expect(await noteOf(game.spin(u.id))).toContain(MARKETPLACE_POINTS_ORDER_ONLY_NOTE);
    expect(await noteOf(game.buyTree(u.id))).toContain(MARKETPLACE_POINTS_ORDER_ONLY_NOTE);
    expect(await noteOf(loyalty.redeemReward(u.id, giftId, `rk-${randCode(12)}`))).toContain(MARKETPLACE_POINTS_ORDER_ONLY_NOTE);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 1_000 });
  });

  it('không có điểm sàn: câu báo thiếu điểm giữ nguyên, không kèm câu về điểm sàn', async () => {
    const u = await userWithLots(prisma, { standard: 5 }, touched);
    const msg = await noteOf(game.spin(u.id));
    expect(msg).not.toContain(MARKETPLACE_POINTS_ORDER_ONLY_NOTE);
  });

  it('đơn tiêu điểm sàn chạy chồng với quay ×3, góp cây ×2, đổi quà ×2: đơn thành công, các lượt kia 400, chỉ đơn chạm lô MARKETPLACE', async () => {
    const u = await userWithLots(prisma, { marketplace: 1_000 }, touched);
    const { addr } = await cartWithLines(prisma, cart, u.id, 1);
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 200 } as never),
      ...Array.from({ length: 3 }, () => game.spin(u.id)),
      ...Array.from({ length: 2 }, () => game.buyTree(u.id)),
      ...Array.from({ length: 2 }, () => loyalty.redeemReward(u.id, giftId, `rk-${randCode(12)}`)),
    ]);
    const s = summarize(results);
    console.log('[w42-game] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(s.fulfilled).toHaveLength(1);
    for (const r of s.rejected) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as Error).message).toContain(MARKETPLACE_POINTS_ORDER_ONLY_NOTE);
    }
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 800 });
    const touchedMarketplace = await prisma.pointsTransaction.findMany({ where: { userId: u.id, lot: 'MARKETPLACE', delta: { lt: 0 } } });
    expect(touchedMarketplace.map((r) => r.reason.split(':')[0])).toEqual(['ORDER_REDEEM_MARKETPLACE']);
  });
});
