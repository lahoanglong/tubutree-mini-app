import { BadRequestException } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { pgLikeClient } from '../../../test/fakes/race-db-client';
import { CouponsService, NEW_CUSTOMER_ONLY_MSG } from './coupons.service';

/**
 * Hai request đua nhau dùng/trả lượt của cùng một mã giảm giá (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts):
 * redeemInTx/release chạy THẬT trên cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá + advisory lock.
 * Bất biến: số dòng couponRedemption của mã == usedCount (mã có usageLimit), không vượt usageLimit, không vượt perUserLimit.
 */
const baseCoupon = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'SALE',
  scope: 'PUBLIC',
  scopeMeta: null,
  createdById: null,
  newCustomerOnly: false,
  perUserLimit: 1,
  usageLimit: 1,
  usedCount: 0,
  ...over,
});

function setup(coupon: Record<string, unknown>, redemptions: { orderId: string; userId: string }[] = []) {
  const db = new RaceDb({
    coupon: {},
    couponRedemption: { unique: [{ fields: ['couponId', 'orderId'] }] },
    order: {},
    user: {},
    couponClaim: {},
  });
  db.seed('coupon', [coupon]);
  db.seed(
    'couponRedemption',
    redemptions.map((r) => ({ couponId: 'c1', ...r })),
  );
  // Advisory lock theo (mã, khách) và theo khách (đơn đầu): chỉ khoá khi chính câu SQL gọi pg_advisory_xact_lock.
  db.handlers.push({
    match: /pg_advisory_xact_lock/,
    run: (c) => c.lockKey(c.params.join('|')).then(() => 1),
  });
  const client = pgLikeClient(db);
  const svc = new CouponsService(client as never);
  const redemptionsNow = () => db.rows('couponRedemption');
  const usedCount = () => db.row('coupon', 'c1')!.usedCount as number;
  return { db, client, svc, redemptionsNow, usedCount };
}

const split = (settled: PromiseSettledResult<unknown>[]) => ({
  ok: settled.filter((s) => s.status === 'fulfilled'),
  failed: settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected'),
});

describe('CouponsService.redeem — race', () => {
  // Trong checkout, redeem không phải câu cuối của transaction (còn ghi sự kiện, dọn giỏ): `tail` giữ khoá dòng mã thêm một câu để bên kia thật sự
  // phải chờ khoá rồi xét lại WHERE, thay vì tx đầu commit trước khi tx sau kịp bắt đầu câu giành lượt.
  it.each([
    ['perUserLimit 1, redeem tự mở transaction', 1, false],
    ['không giới hạn theo người, redeem tự mở transaction', 0, false],
    ['perUserLimit 1, redeem trong transaction còn câu ghi sau đó', 1, true],
    ['không giới hạn theo người, redeem trong transaction còn câu ghi sau đó', 0, true],
  ])('hai khách tranh lượt cuối của mã dùng-một-lần (%s): đúng MỘT bên thắng, bên thua nhận "hết lượt" và không để lại dòng nào', async (_label, perUserLimit, tail) => {
    const { db, client, svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 1, perUserLimit }));
    const redeem = (userId: string, orderId: string) =>
      tail
        ? client.$transaction(async (tx: any) => {
            await svc.redeem('SALE', userId, orderId, tx);
            await tx.order.create({ data: { id: orderId, userId, status: 'CONFIRMED' } });
          })
        : svc.redeem('SALE', userId, orderId);
    const settled = await Promise.allSettled([redeem('u1', 'o1'), redeem('u2', 'o2')]);
    const { ok, failed } = split(settled);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
    expect((failed[0]!.reason as Error).message).toBe('Mã giảm giá đã hết lượt sử dụng.');
    expect(redemptionsNow()).toHaveLength(1);
    expect(usedCount()).toBe(1);
    if (tail) {
      expect(db.rows('order')).toHaveLength(1);
      expect(db.stats.lockWaits).toBeGreaterThan(0); // hai bên thật sự chạm nhau ở dòng mã
      expect(db.stats.rollbacks).toBeGreaterThan(0); // dòng redemption bên thua đã chèn rồi bị huỷ theo transaction
    }
  });

  it('sáu khách tranh hai lượt còn lại (usageLimit 5, đã dùng 3): đúng hai bên thắng, usedCount dừng ở 5', async () => {
    const { svc, redemptionsNow, usedCount } = setup(
      baseCoupon({ usageLimit: 5, usedCount: 3, perUserLimit: 0 }),
      [
        { orderId: 'old1', userId: 'a' },
        { orderId: 'old2', userId: 'b' },
        { orderId: 'old3', userId: 'c' },
      ],
    );
    const settled = await Promise.allSettled(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((u, i) => svc.redeem('SALE', u, `o${i + 1}`)));
    const { ok, failed } = split(settled);
    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(4);
    expect(usedCount()).toBe(5);
    expect(redemptionsNow()).toHaveLength(5);
  });

  it('cùng một khách gửi hai đơn khác nhau song song với mã perUserLimit 1: đúng một đơn được dùng, đơn kia nhận "đã dùng hết lượt"', async () => {
    const { db, svc, redemptionsNow } = setup(baseCoupon({ usageLimit: null, perUserLimit: 1 }));
    const settled = await Promise.allSettled([svc.redeem('SALE', 'u1', 'o1'), svc.redeem('SALE', 'u1', 'o2')]);
    const { ok, failed } = split(settled);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as Error).message).toBe('Bạn đã dùng hết lượt cho mã này.');
    expect(redemptionsNow()).toHaveLength(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('cùng khách, perUserLimit 2, bốn đơn song song: đúng hai đơn dùng được mã', async () => {
    const { svc, redemptionsNow } = setup(baseCoupon({ usageLimit: null, perUserLimit: 2 }));
    const settled = await Promise.allSettled(['o1', 'o2', 'o3', 'o4'].map((o) => svc.redeem('SALE', 'u1', o)));
    expect(split(settled).ok).toHaveLength(2);
    expect(redemptionsNow()).toHaveLength(2);
  });

  it('mã không giới hạn theo người, cùng đơn gửi hai lần song song (double-submit): một dòng lượt dùng, usedCount tăng một lần, cả hai lần đều thành công', async () => {
    const { svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 3, perUserLimit: 0 }));
    await Promise.all([svc.redeem('SALE', 'u1', 'o1'), svc.redeem('SALE', 'u1', 'o1')]);
    expect(redemptionsNow()).toHaveLength(1);
    expect(usedCount()).toBe(1);
  });

  it('mã perUserLimit 1, cùng đơn gửi hai lần song song: lần sau thấy dòng của lần đầu và không làm gì, usedCount tăng một lần', async () => {
    const { svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 3, perUserLimit: 1 }));
    await Promise.all([svc.redeem('SALE', 'u1', 'o1'), svc.redeem('SALE', 'u1', 'o1')]);
    expect(redemptionsNow()).toHaveLength(1);
    expect(usedCount()).toBe(1);
  });

  it('mã chỉ-khách-mới: cùng khách đặt hai đơn song song (mỗi đơn đã ghi trong transaction của mình): đúng một đơn qua, đơn kia nhận câu "chỉ dành cho khách đặt đơn đầu tiên" và bị rollback', async () => {
    const { db, client, svc, redemptionsNow } = setup(baseCoupon({ newCustomerOnly: true, usageLimit: null, perUserLimit: 1 }));
    const place = (orderId: string) =>
      client.$transaction(async (tx: any) => {
        await tx.order.create({ data: { id: orderId, userId: 'u1', status: 'CONFIRMED', checkoutGroup: null } });
        await svc.redeem('SALE', 'u1', orderId, tx);
      });
    const settled = await Promise.allSettled([place('o1'), place('o2')]);
    const { ok, failed } = split(settled);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as Error).message).toBe(NEW_CUSTOMER_ONLY_MSG);
    expect(db.rows('order')).toHaveLength(1);
    expect(redemptionsNow()).toHaveLength(1);
  });
});

describe('CouponsService.release — race', () => {
  it('hai đường huỷ cùng một đơn chạy song song trong khi đơn khác vẫn giữ lượt: trả đúng MỘT lượt, usedCount còn 1 (không về 0)', async () => {
    const { db, client, svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 3, usedCount: 2, perUserLimit: 0 }), [
      { orderId: 'o1', userId: 'u1' },
      { orderId: 'o2', userId: 'u2' },
    ]);
    await Promise.all([
      client.$transaction((tx: any) => svc.release('SALE', 'o1', tx)),
      client.$transaction((tx: any) => svc.release('SALE', 'o1', tx)),
    ]);
    expect(redemptionsNow().map((r) => r.orderId)).toEqual(['o2']);
    expect(usedCount()).toBe(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('usedCount đã lệch thấp hơn số dòng lượt dùng (mã được đặt giới hạn sau khi đã có người dùng): trả lượt không kéo usedCount xuống âm', async () => {
    const { client, svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 3, usedCount: 0, perUserLimit: 0 }), [
      { orderId: 'o1', userId: 'u1' },
    ]);
    await client.$transaction((tx: any) => svc.release('SALE', 'o1', tx));
    expect(redemptionsNow()).toHaveLength(0);
    expect(usedCount()).toBe(0);
  });

  // Lượt cuối đang do đơn o1 giữ. Đơn o1 bị huỷ (trả lượt) cùng lúc khách khác dùng mã cho đơn o2: tuỳ ai tới trước mà o2 được dùng hoặc bị
  // báo hết lượt, nhưng sổ phải khớp bộ đếm và không bao giờ có hai lượt sống trên mã usageLimit 1. `delay` dịch thời điểm của mỗi bên để
  // thử nhiều cách xen kẽ.
  const delays = [0, 1, 2, 3, 4, 5, 6, 8];
  const pairs = delays.flatMap((a) => delays.map((b) => [a, b] as const));
  it.each(pairs)('trả lượt của o1 (trễ %i tick) chạy cùng lúc khách khác dùng lại (trễ %i tick): sổ khớp bộ đếm, không quá usageLimit', async (releaseDelay, redeemDelay) => {
    const { client, svc, redemptionsNow, usedCount } = setup(baseCoupon({ usageLimit: 1, usedCount: 1, perUserLimit: 1 }), [
      { orderId: 'o1', userId: 'u1' },
    ]);
    const later = async <T>(ticks: number, fn: () => Promise<T>) => {
      for (let i = 0; i < ticks; i += 1) await tick();
      return fn();
    };
    const settled = await Promise.allSettled([
      later(releaseDelay, () => client.$transaction((tx: any) => svc.release('SALE', 'o1', tx))),
      later(redeemDelay, () => svc.redeem('SALE', 'u2', 'o2')),
    ]);
    const live = redemptionsNow();
    expect(settled[0]!.status).toBe('fulfilled');
    expect(live.length).toBeLessThanOrEqual(1);
    expect(usedCount()).toBe(live.length);
    // o2 dùng được mã đúng khi dòng của nó còn trong sổ; o1 đã trả thì không còn.
    expect(live.some((r) => r.orderId === 'o1')).toBe(false);
    expect(live.some((r) => r.orderId === 'o2')).toBe(settled[1]!.status === 'fulfilled');
    if (settled[1]!.status === 'rejected') expect(((settled[1] as PromiseRejectedResult).reason as Error).message).toBe('Mã giảm giá đã hết lượt sử dụng.');
  });
});
