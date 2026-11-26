import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, pinConfig, summarize, warmPool } from './helpers';
import { cartWithLines, lotsOf, w42Module } from './w42-helpers';

const DAY = 864e5;

/**
 * W42: cron hết hạn chạy theo từng lô có hạn (STANDARD, MARKETPLACE). Lô sàn đã quá hạn chạy chồng với lần đặt đơn tiêu chính lô đó:
 * điểm chỉ mất một lần (hoặc tiêu, hoặc hết hạn), không lô nào âm, và hết hạn lô sàn không đụng lô thường còn hạn.
 */
describe('W42: hết hạn lô MARKETPLACE chồng với đặt đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let expiry: LoyaltyExpiryService;
  const touched: string[] = [];
  const restore: (() => Promise<void>)[] = [];
  const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } as unknown as NotificationsService;

  beforeAll(async () => {
    moduleRef = await w42Module();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    expiry = new LoyaltyExpiryService(prisma, moduleRef.get(SystemConfigService), notifications);
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

  /** Khách có lô sàn đã quá hạn một phút (và tuỳ chọn lô thường còn hạn), sổ khớp số dư. */
  async function userWithExpiredMarketplace(marketplace: number, standard = 0) {
    const u = await createUser(prisma, { pointsMarketplaceBalance: marketplace, pointsBalance: standard });
    touched.push(u.id);
    const createdAt = new Date(Date.now() - 400 * DAY);
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: u.id, delta: marketplace, lot: 'MARKETPLACE', reason: 'IT_SEED_MARKETPLACE', refType: 'IT', createdAt, expiresAt: new Date(Date.now() - 60_000) },
        ...(standard > 0 ? [{ userId: u.id, delta: standard, lot: 'STANDARD' as const, reason: 'IT_SEED_STANDARD', refType: 'IT', expiresAt: new Date(Date.now() + 180 * DAY) }] : []),
      ],
    });
    return u;
  }

  it('cron hết hạn chỉ trừ lô MARKETPLACE quá hạn, lô STANDARD còn hạn giữ nguyên', async () => {
    const u = await userWithExpiredMarketplace(5_000, 10_000);
    await expiry.expirePoints();
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 10_000, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0 });
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: 'POINTS_EXPIRED' } });
    expect(rows.map((r) => [r.lot, r.delta])).toEqual([['MARKETPLACE', -5_000]]);
  });

  it.each([1, 2, 3])('vòng %d: expirePoints ×2 + đặt đơn tiêu lô sàn quá hạn cùng lúc → điểm mất đúng một lần, không âm', async () => {
    const u = await userWithExpiredMarketplace(20_000);
    const { addr } = await cartWithLines(prisma, cart, u.id, 1);
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      expiry.expirePoints(),
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 20_000 } as never),
      expiry.expirePoints(),
    ]);
    const s = summarize(results);
    console.log('[w42-expiry] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[2]!.status).toBe('fulfilled');
    if (results[1]!.status === 'rejected') expect(String((results[1] as PromiseRejectedResult).reason?.message)).toContain('Điểm Xanh tích từ đơn sàn của bạn đã thay đổi');

    const order = await prisma.order.findFirst({ where: { userId: u.id } });
    const spent = order?.pointsUsedMarketplace ?? 0;
    const expired = await prisma.pointsTransaction.aggregate({ where: { userId: u.id, reason: 'POINTS_EXPIRED', lot: 'MARKETPLACE' }, _sum: { delta: true } });
    expect(spent + -(expired._sum.delta ?? 0)).toBe(20_000);
    expect(await lotsOf(prisma, u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0 });
  });
});
