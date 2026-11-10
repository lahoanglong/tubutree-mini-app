import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { pgLikeClient } from '../../../test/fakes/race-db-client';
import { CouponsService } from '../coupons/coupons.service';
import { OrderReversalService } from './order-reversal.service';
import { OrdersService } from './orders.service';

/**
 * Huỷ đơn chạy song song với chính nó, với nhóm đơn tách và với việc dùng lại mã vừa được trả (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts).
 * OrdersService.cancel + OrderReversalService.reverseFinancials + CouponsService.release/redeem chạy THẬT trong một transaction trên cơ sở dữ liệu giả có khoá
 * dòng + xét lại WHERE sau khoá + advisory lock: hoàn Ví, trả kho và trả lượt mã chỉ được xảy ra đúng một lần cho mỗi đơn.
 */
const item = (id: string, variationId: string) => ({ id, variationId, quantity: 1, backorderedQty: 0, flashSaleItemId: null });
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  type: 'RETAIL',
  status: 'CONFIRMED',
  paymentMethod: 'WALLET',
  paymentStatus: 'PAID',
  total: 50_000,
  couponCode: null,
  checkoutGroup: null,
  placedForCustomer: false,
  pointsUsed: 0,
  pointsUsedConverted: 0,
  autoCancelBlockedAt: null,
  hasRecyclingPickup: false,
  pancakeOrderId: null,
  fulfiller: 'TUBU',
  referrerUserId: null,
  reversalEffectsAt: null,
  items: [item('i1', 'v1')],
  ...over,
});

function setup(orders: Record<string, unknown>[], coupon: Record<string, unknown> | null, redemptions: { orderId: string; userId: string }[] = []) {
  const db = new RaceDb({
    user: {},
    order: {},
    orderStatusHistory: {},
    orderCustomerRefund: { unique: [{ fields: ['orderId', 'kind', 'refKey'] }] },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    variation: {},
    coupon: {},
    couponRedemption: { unique: [{ fields: ['couponId', 'orderId'] }] },
    dealerCreditLedger: {},
    analyticsEvent: {},
    couponClaim: {},
  });
  db.seed('user', [{ id: 'u1', walletBalance: 40_000, metadata: null }, { id: 'u2', walletBalance: 0, metadata: null }]);
  db.seed('order', orders);
  db.seed('variation', [
    { id: 'v1', stock: 4, reservedStock: 1 },
    { id: 'v2', stock: 4, reservedStock: 1 },
  ]);
  if (coupon) db.seed('coupon', [coupon]);
  db.seed('couponRedemption', redemptions.map((r) => ({ couponId: 'c1', ...r })));
  db.handlers.push(
    {
      match: /FROM "orders" WHERE "id"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('order', c.params[0] as string);
        return c.rows('order').filter((o) => o.id === c.params[0]).map((o) => ({ id: o.id }));
      },
    },
    {
      match: /FROM "users" WHERE "id"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('user', c.params[0] as string);
        const u = c.rows('user').find((r) => r.id === c.params[0]);
        return u ? [{ id: u.id, walletBalance: u.walletBalance, metadata: u.metadata }] : [];
      },
    },
    {
      match: /UPDATE "variations"[\s\S]*"stock" = "stock" \+ /,
      run: async (c) => {
        const [qty, , variationId] = c.params as [number, number, string];
        await c.lockRow('variation', variationId);
        const row = c.rows('variation').find((r) => r.id === variationId);
        if (!row) return 0;
        await c.client.variation.update({ where: { id: variationId }, data: { stock: row.stock + qty, reservedStock: Math.max(0, row.reservedStock - qty) } });
        return 1;
      },
    },
    { match: /pg_advisory_xact_lock/, run: (c) => c.lockKey(c.params.join('|')).then(() => 1) },
  );
  const client = pgLikeClient(db);
  const coupons = new CouponsService(client as never);
  const reversal = new OrderReversalService({} as never, coupons);
  const notifySafe = jest.fn().mockResolvedValue(true);
  const svc = new OrdersService(
    client as never,
    { pointsExpiresAt: async () => new Date(), reverseOrderPoints: jest.fn().mockResolvedValue(0) } as never,
    {} as never,
    { notifySafe, notify: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as never,
    reversal,
  );
  const wallet = (id: string) => db.row('user', id)!.walletBalance as number;
  const refunds = () => db.rows('walletTransaction').filter((r) => r.type === 'ORDER_REFUND');
  const stock = (id: string) => db.row('variation', id)!;
  const usedCount = () => db.row('coupon', 'c1')!.usedCount as number;
  const redemptions_ = () => db.rows('couponRedemption');
  return { db, client, coupons, svc, wallet, refunds, stock, usedCount, redemptions: redemptions_, notifySafe };
}

const coupon = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'ONCE',
  scope: 'PUBLIC',
  scopeMeta: null,
  createdById: null,
  newCustomerOnly: false,
  perUserLimit: 1,
  usageLimit: 3,
  usedCount: 2,
  ...over,
});

describe('OrdersService.cancel — race', () => {
  it.each([2, 3])('khách bấm huỷ đơn Ví đã trả %i lần chạy chồng: hoàn Ví một lần, kho trả một lần, lượt mã trả một lần, mọi lần bấm đều thấy đơn đã huỷ', async (taps) => {
    const { db, svc, wallet, refunds, stock, usedCount, redemptions } = setup(
      [order({ couponCode: 'ONCE' })],
      coupon(),
      [
        { orderId: 'o1', userId: 'u1' },
        { orderId: 'oX', userId: 'u9' },
      ],
    );
    const results = await Promise.all(Array.from({ length: taps }, () => svc.cancel('u1', 'TUBU1')));
    expect(results.every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(db.row('order', 'o1')).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(wallet('u1')).toBe(90_000);
    expect(refunds().map((r) => [r.refId, r.delta])).toEqual([['o1', 50_000]]);
    expect(stock('v1')).toMatchObject({ stock: 5, reservedStock: 0 });
    expect(redemptions().map((r) => r.orderId)).toEqual(['oX']);
    expect(usedCount()).toBe(1);
    expect(db.rows('orderStatusHistory').filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  // Đơn Ví đi qua khoá dòng user khi hoàn tiền nên hai đơn con của một khách tự xếp hàng trước bước trả mã; đơn COD chưa thu không đụng Ví
  // nên khoá advisory theo nhóm là thứ duy nhất xếp hàng hai lần huỷ: thiếu nó cả hai cùng thấy đơn kia còn sống và lượt mã mất vĩnh viễn.
  it.each([
    ['WALLET', 'PAID', 40_000 + 50_000 + 30_000, 2],
    ['COD', 'UNPAID', 40_000, 0],
  ])(
    'hai đơn con của một lần đặt bị tách (%s) huỷ cùng lúc (mã gắn đơn đầu): lượt mã được trả đúng MỘT lần, và chỉ khi cả hai đơn đã huỷ',
    async (paymentMethod, paymentStatus, walletAfter, refundCount) => {
      const { db, svc, wallet, refunds, stock, usedCount, redemptions } = setup(
        [
          order({ couponCode: 'ONCE', checkoutGroup: 'TUBU1', paymentMethod, paymentStatus }),
          order({ id: 'o2', code: 'TUBU2', total: 30_000, checkoutGroup: 'TUBU1', paymentMethod, paymentStatus, items: [item('i2', 'v2')] }),
        ],
        coupon(),
        [
          { orderId: 'o1', userId: 'u1' },
          { orderId: 'oX', userId: 'u9' },
        ],
      );
      await Promise.all([svc.cancel('u1', 'TUBU1'), svc.cancel('u1', 'TUBU2')]);
      expect(db.rows('order').map((o) => o.status)).toEqual(['CANCELLED', 'CANCELLED']);
      expect(wallet('u1')).toBe(walletAfter);
      expect(refunds()).toHaveLength(refundCount);
      expect(stock('v1')).toMatchObject({ stock: 5, reservedStock: 0 });
      expect(stock('v2')).toMatchObject({ stock: 5, reservedStock: 0 });
      expect(redemptions().map((r) => r.orderId)).toEqual(['oX']);
      expect(usedCount()).toBe(1);
      expect(db.stats.lockWaits).toBeGreaterThan(0);
    },
  );

  it('huỷ đơn đầu của nhóm khi đơn con còn sống: mã vẫn tính là đã dùng (không trả lượt khi chưa huỷ hết nhóm)', async () => {
    const { svc, usedCount, redemptions } = setup(
      [
        order({ couponCode: 'ONCE', checkoutGroup: 'TUBU1' }),
        order({ id: 'o2', code: 'TUBU2', total: 30_000, checkoutGroup: 'TUBU1', items: [item('i2', 'v2')] }),
      ],
      coupon(),
      [{ orderId: 'o1', userId: 'u1' }, { orderId: 'oX', userId: 'u9' }],
    );
    await svc.cancel('u1', 'TUBU1');
    expect(redemptions().map((r) => r.orderId).sort()).toEqual(['o1', 'oX']);
    expect(usedCount()).toBe(2);
    await svc.cancel('u1', 'TUBU2');
    expect(redemptions().map((r) => r.orderId)).toEqual(['oX']);
    expect(usedCount()).toBe(1);
  });

  // Mã usageLimit 1 đang do đơn o1 giữ. Khách huỷ o1 (trả lượt) cùng lúc khách khác dùng mã cho o2: tuỳ ai tới trước mà o2 được dùng hoặc báo hết
  // lượt, nhưng sổ phải khớp bộ đếm, không bao giờ có hai lượt sống trên mã dùng-một-lần, và o2 chỉ có dòng trong sổ khi nó thật sự dùng được.
  const delays = [0, 3, 6, 10, 15, 22, 30, 40];
  const pairs = delays.flatMap((a) => delays.map((b) => [a, b] as const));
  it.each(pairs)('huỷ đơn o1 giữ lượt cuối (trễ %i tick) cùng lúc khách khác dùng lại mã (trễ %i tick): sổ khớp bộ đếm, không quá usageLimit', async (cancelDelay, redeemDelay) => {
    const { db, svc, coupons, wallet, usedCount, redemptions } = setup(
      [order({ couponCode: 'ONCE' })],
      coupon({ usageLimit: 1, usedCount: 1 }),
      [{ orderId: 'o1', userId: 'u1' }],
    );
    const later = async <T>(ticks: number, fn: () => Promise<T>) => {
      for (let i = 0; i < ticks; i += 1) await tick();
      return fn();
    };
    const settled = await Promise.allSettled([later(cancelDelay, () => svc.cancel('u1', 'TUBU1')), later(redeemDelay, () => coupons.redeem('ONCE', 'u2', 'o2'))]);
    expect(settled[0]!.status).toBe('fulfilled');
    const live = redemptions();
    expect(live.length).toBeLessThanOrEqual(1);
    expect(usedCount()).toBe(live.length);
    expect(live.some((r) => r.orderId === 'o1')).toBe(false);
    expect(live.some((r) => r.orderId === 'o2')).toBe(settled[1]!.status === 'fulfilled');
    expect(wallet('u1')).toBe(90_000);
    expect(db.row('order', 'o1')).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
  });
});
