import { HttpException } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { startOfVnDay, vnDateKey } from '../../common/vn-time';
import { SUBSCRIPTION_DUPLICATE, SubscriptionsService } from './subscriptions.service';

/**
 * Các đường ghi của gói định kỳ mà subscription-cycle.race.spec.ts (cron chen Tạm dừng/Huỷ/Bỏ qua kỳ) chưa phủ: tạo gói song song
 * (partial unique), sửa gói chen Tạm dừng/Huỷ/Tiếp tục, tạo gói chen bật lại gói đã huỷ. Postgres READ COMMITTED (race-db.fake.ts).
 * Dùng SubscriptionsService + WalletLedgerService THẬT; chỉ cơ sở dữ liệu và các dịch vụ giá/thông báo được giả.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const errorCode = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' && r.reason instanceof HttpException ? (r.reason.getResponse() as { code?: string }).code ?? null : null;

const UNIT = 50_000;
const DAY = 86_400_000;
const OPEN = ['ACTIVE', 'PAUSED'];
const FULL_TOTAL = 88_000; // 2 x 50.000đ giảm 12% (bậc mặc định), phí giao 0
const HALF_TOTAL = 44_000; // 1 x 50.000đ giảm 12%
const LATER = vnDateKey(new Date(Date.now() + 3 * DAY)); // ngày bắt đầu sau hôm nay: tạo gói không sinh đơn đầu

function setup() {
  const db = new RaceDb({
    subscription: {
      // Cùng partial unique subscriptions_user_variation_address_open_key: chỉ gói ACTIVE/PAUSED bị ràng buộc.
      unique: [{ fields: ['userId', 'variationId', 'addressId'], when: (r) => OPEN.includes(r.status) }],
      defaults: { status: 'ACTIVE', retryCount: 0, paymentMethod: 'COD', lastOrderId: null },
    },
    variation: { relations: { product: { table: 'product', fk: 'productId' } } },
    product: {},
    address: {},
    user: {},
    order: { unique: [{ fields: ['idempotencyKey'] }, { fields: ['code'] }] },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    analyticsEvent: {},
  });
  db.seed('variation', [
    { id: 'v1', name: 'Hộp', isActive: true, pancakeId: 'pk1', productId: 'p1', salePrice: null, retailPrice: UNIT, stock: 10, reservedStock: 0, product: { name: 'Sữa', storefrontId: null } },
  ]);
  db.seed('product', [{ id: 'p1', name: 'Sữa', slug: 'sua', isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU', storefrontId: null }]);
  const address = (id: string) => ({ id, userId: 'u1', recipient: 'An', phone: '0900000000', province: 'HCM', district: 'Q1', ward: 'P1', street: '1 Lê Lợi', provinceCode: 1, districtCode: 1, wardCode: 1 });
  db.seed('address', [address('a1'), address('a2')]);
  db.seed('user', [{ id: 'u1', tierId: null, walletBalance: 500_000 }]);

  db.handlers.push(
    {
      match: /SELECT "walletBalance" FROM "users"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('user', c.params[0] as string);
        return [{ walletBalance: c.rows('user').find((r) => r.id === c.params[0])?.walletBalance }];
      },
    },
    {
      match: /FROM "subscriptions" WHERE "id" = \?/,
      run: async (c) => {
        if (c.locking) await c.lockRow('subscription', c.params[0] as string);
        const r = c.rows('subscription').find((x) => x.id === c.params[0]);
        return r ? [r] : [];
      },
    },
    {
      match: /UPDATE "variations"\s+SET "stock" = "stock" - \?/,
      run: async (c) => {
        const [quantity, , id] = c.params as [number, number, string, number];
        await c.lockRow('variation', id);
        const fresh = c.rows('variation').find((r) => r.id === id);
        if (!fresh || fresh.stock < quantity) return 0;
        await c.client.variation.update({ where: { id }, data: { stock: { decrement: quantity }, reservedStock: { increment: quantity } } });
        return 1;
      },
    },
  );
  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const pricing = { calcShippingFee: async () => 0, calcPointsEarned: async () => 0 };
  const loyalty = { getTierMultiplier: async () => 1 };
  const notifications = { notifySafe: jest.fn().mockResolvedValue(true) };
  const pancakeOrder = { enqueuePush: jest.fn().mockResolvedValue(undefined) };
  const analytics = {
    record: async (tx: any, e: { eventName: string; props?: { action?: string } }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName, action: e.props?.action } });
    },
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SubscriptionsService(db.client, config as never, pricing as never, loyalty as never, notifications as never, pancakeOrder as never, analytics as never, new WalletLedgerService());
  return {
    db,
    svc,
    pancakeOrder,
    orders: () => db.rows('order'),
    wallet: () => db.row('user', 'u1')!.walletBalance as number,
    ledger: () => db.rows('walletTransaction'),
    variation: () => db.row('variation', 'v1')!,
    openSubs: () => db.rows('subscription').filter((s) => OPEN.includes(s.status)),
    events: (action: string) => db.rows('analyticsEvent').filter((e) => e.eventName === 'subscription_changed' && e.action === action),
  };
}

const NEW_SUB = { variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a1', paymentMethod: 'WALLET' as const };

describe('SubscriptionsService.create — song song', () => {
  it('ba lần bấm "Bắt đầu đặt định kỳ" giao ngay trả Ví sát nhau (quét thời điểm): đúng MỘT gói, MỘT đơn đầu, Ví trừ một lần, kho giữ chỗ một lần; cả ba đều nhận lời đồng ý, chỉ một kèm đơn đầu', async () => {
    let rolledBack = 0;
    for (let skew = 0; skew <= 30; skew++) {
      const { db, svc, orders, wallet, ledger, variation, openSubs, pancakeOrder } = setup();
      const call = async (i: number) => (await delay(i * skew), svc.create('u1', NEW_SUB));
      const results = await Promise.allSettled([call(0), call(1), call(2)]);
      const label = `skew ${skew}`;
      is(label, results.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled']);
      const ok = results.map((r) => (r as PromiseFulfilledResult<{ id: string; firstOrder?: unknown }>).value);
      is(label, openSubs().length, 1);
      is(label, new Set(ok.map((r) => r.id)).size, 1);
      is(label, ok.filter((r) => r.firstOrder).length, 1);
      is(label, orders().length, 1);
      is(label, orders()[0]!.subscriptionId, openSubs()[0]!.id);
      is(label, orders()[0]!.total, FULL_TOTAL);
      is(label, wallet(), 500_000 - FULL_TOTAL);
      is(label, ledger().length, 1);
      is(label, variation().stock, 8);
      is(label, variation().reservedStock, 2);
      is(label, pancakeOrder.enqueuePush.mock.calls.length, 1);
      rolledBack += db.stats.rollbacks;
    }
    expect(rolledBack).toBeGreaterThan(0); // có lượt kẻ đến sau thật sự đụng partial unique rồi rollback
  });

  it('hai lần tạo khác số lượng cho cùng sản phẩm + địa chỉ (quét thời điểm): một bên thắng, bên kia 409 SUBSCRIPTION_DUPLICATE; không đơn thừa, Ví trừ đúng phần của bên thắng', async () => {
    const seen = new Set<string>();
    for (let skew = -25; skew <= 25; skew++) {
      const { svc, orders, wallet, ledger, variation, openSubs } = setup();
      const two = async () => (await delay(Math.max(skew, 0)), svc.create('u1', { ...NEW_SUB, quantity: 2 }));
      const one = async () => (await delay(Math.max(-skew, 0)), svc.create('u1', { ...NEW_SUB, quantity: 1 }));
      const [a, b] = await Promise.allSettled([two(), one()]);
      const label = `skew ${skew}`;
      const winners = [a, b].filter((r) => r.status === 'fulfilled');
      is(label, winners.length, 1);
      const loser = a.status === 'fulfilled' ? b : a;
      is(label, httpStatus(loser), 409);
      is(label, errorCode(loser), SUBSCRIPTION_DUPLICATE);
      const quantity = a.status === 'fulfilled' ? 2 : 1;
      is(label, openSubs().length, 1);
      is(label, openSubs()[0]!.quantity, quantity);
      is(label, orders().length, 1);
      is(label, wallet(), 500_000 - (quantity === 2 ? FULL_TOTAL : HALF_TOTAL));
      is(label, ledger().length, 1);
      is(label, variation().reservedStock, quantity);
      seen.add(`bên ${quantity} thắng`);
    }
    expect(seen).toEqual(new Set(['bên 2 thắng', 'bên 1 thắng']));
  });
});

describe('SubscriptionsService.update chen setStatus', () => {
  const ORDER_AT = new Date(Date.now() - 2 * DAY);
  // Gói đã ra đơn kỳ trước 2 ngày: đổi chu kỳ 4 → 8 tuần tính lại nextRunAt từ ngày đơn đó (đổi cả ngày giao kế, không chỉ chu kỳ).
  const PATCHED_NEXT = startOfVnDay(ORDER_AT).getTime() + 8 * 7 * DAY;

  function setupEdit(initial: 'ACTIVE' | 'PAUSED') {
    const ctx = setup();
    const nextRunAt = new Date(Date.now() + 10 * DAY);
    ctx.db.seed('order', [{ id: 'o0', createdAt: ORDER_AT }]);
    ctx.db.seed('subscription', [
      { id: 's1', userId: 'u1', variationId: 'v1', addressId: 'a1', quantity: 2, status: initial, paymentMethod: 'COD', intervalWeeks: 4, nextRunAt, lastOrderId: 'o0', retryCount: 0 },
    ]);
    return { ...ctx, nextRunAt };
  }

  it.each([
    ['ACTIVE', 'PAUSED'],
    ['ACTIVE', 'CANCELLED'],
    ['PAUSED', 'ACTIVE'],
    ['PAUSED', 'CANCELLED'],
  ] as const)(
    'gói %s: khách Sửa (đổi chu kỳ + số lượng) chen với %s (quét thời điểm): lệnh Tạm dừng/Huỷ/Tiếp tục không ghi cũ kéo ngược lịch vừa sửa; lỗi chỉ 400 (đã huỷ) hoặc 409',
    async (initial, target) => {
      const seen = new Set<string>();
      for (let skew = -30; skew <= 30; skew++) {
        const { db, svc, nextRunAt, events } = setupEdit(initial);
        const edit = async () => (await delay(Math.max(skew, 0)), svc.update('u1', 's1', { intervalWeeks: 8, quantity: 3 }));
        const act = async () => (await delay(Math.max(-skew, 0)), svc.setStatus('u1', 's1', target));
        const [edited, acted] = await Promise.allSettled([edit(), act()]);
        const label = `skew ${skew}`;
        const sub = db.row('subscription', 's1')!;
        if (acted.status === 'fulfilled') is(label, sub.status, target);
        else {
          is(label, httpStatus(acted), 409);
          is(label, sub.status, initial);
        }
        if (edited.status === 'fulfilled') {
          is(label, [sub.intervalWeeks, sub.quantity], [8, 3]);
          is(label, sub.nextRunAt.getTime(), PATCHED_NEXT);
        } else {
          // Sửa chỉ bị từ chối khi gói đã huỷ trước đó, và khi đó không ghi gì.
          is(label, [httpStatus(edited), target, sub.status], [400, 'CANCELLED', 'CANCELLED']);
          is(label, [sub.intervalWeeks, sub.quantity], [4, 2]);
          is(label, sub.nextRunAt.getTime(), nextRunAt.getTime());
        }
        is(label, events('updated').length, edited.status === 'fulfilled' ? 1 : 0);
        const statusEvents = ['paused', 'resumed', 'cancelled'].reduce((n, a) => n + events(a).length, 0);
        is(label, statusEvents, acted.status === 'fulfilled' ? 1 : 0);
        seen.add(`sửa ${edited.status}, ${target} ${acted.status}`);
      }
      const expected = new Set(['sửa fulfilled, ' + target + ' fulfilled', 'sửa fulfilled, ' + target + ' rejected']);
      if (target === 'CANCELLED') expected.add('sửa rejected, CANCELLED fulfilled');
      expect(seen).toEqual(expected);
    },
  );
});

describe('SubscriptionsService.setStatus — hai thiết bị cùng đổi một trạng thái', () => {
  // Hai lệnh cùng đọc bản cũ rồi cùng ghi: lệnh đến sau phải nhận 409 (lịch vừa đổi) chứ không ghi chồng lên, trừ khi nó đọc sau khi lệnh trước đã xong
  // (khi đó chỉ là lệnh lặp, không đổi gì). Bỏ `status` khỏi điều kiện ghi thì lệnh đến sau luôn ghi được, không bao giờ 409.
  it.each([
    ['ACTIVE', 'PAUSED', 'paused'],
    ['PAUSED', 'ACTIVE', 'resumed'],
  ] as const)('gói %s: hai lần bấm %s sát nhau (quét thời điểm): trạng thái cuối đúng, lịch không đổi, mỗi lệnh thành công phát đúng một sự kiện, lệnh trễ nếu bị từ chối thì 409', async (initial, target, action) => {
    const seen = new Set<string>();
    for (let skew = -30; skew <= 30; skew++) {
      const { db, svc, events } = setup();
      const nextRunAt = new Date(Date.now() + 10 * DAY);
      db.seed('subscription', [
        { id: 's1', userId: 'u1', variationId: 'v1', addressId: 'a1', quantity: 2, status: initial, paymentMethod: 'COD', intervalWeeks: 4, nextRunAt, lastOrderId: null, retryCount: 0 },
      ]);
      const press = (wait: number) => async () => (await delay(wait), svc.setStatus('u1', 's1', target));
      const results = await Promise.allSettled([press(Math.max(skew, 0))(), press(Math.max(-skew, 0))()]);
      const label = `skew ${skew}`;
      const sub = db.row('subscription', 's1')!;
      const rejected = results.filter((r) => r.status === 'rejected');
      is(label, rejected.map(httpStatus).filter((s) => s !== 409), []);
      is(label, sub.status, target);
      is(label, sub.nextRunAt.getTime(), nextRunAt.getTime());
      is(label, events(action).length, results.length - rejected.length);
      is(label, results.length - rejected.length >= 1, true);
      seen.add(`${results.length - rejected.length} lệnh thành công`);
    }
    expect(seen).toEqual(new Set(['1 lệnh thành công', '2 lệnh thành công']));
  });
});

describe('SubscriptionsService.create chen setStatus bật lại gói đã huỷ', () => {
  it('khách tạo gói mới cùng sản phẩm + địa chỉ lúc đang bật lại gói đã huỷ (quét thời điểm): chỉ một bên thành công, bên kia 409 SUBSCRIPTION_DUPLICATE; luôn đúng MỘT gói đang mở', async () => {
    const seen = new Set<string>();
    for (let skew = -30; skew <= 30; skew++) {
      const { db, svc, openSubs } = setup();
      db.seed('subscription', [
        { id: 's-old', userId: 'u1', variationId: 'v1', addressId: 'a1', quantity: 2, status: 'CANCELLED', paymentMethod: 'COD', intervalWeeks: 4, nextRunAt: new Date(Date.now() + 10 * DAY), lastOrderId: null, retryCount: 0 },
      ]);
      const create = async () => (await delay(Math.max(skew, 0)), svc.create('u1', { ...NEW_SUB, quantity: 1, paymentMethod: 'COD', startDate: LATER }));
      const resume = async () => (await delay(Math.max(-skew, 0)), svc.setStatus('u1', 's-old', 'ACTIVE'));
      const [created, resumed] = await Promise.allSettled([create(), resume()]);
      const label = `skew ${skew}`;
      is(label, [created.status, resumed.status].filter((s) => s === 'fulfilled').length, 1);
      const loser = created.status === 'fulfilled' ? resumed : created;
      is(label, [httpStatus(loser), errorCode(loser)], [409, SUBSCRIPTION_DUPLICATE]);
      is(label, openSubs().length, 1);
      is(label, openSubs()[0]!.id === 's-old', resumed.status === 'fulfilled');
      seen.add(created.status === 'fulfilled' ? 'tạo gói mới thắng' : 'bật lại gói cũ thắng');
    }
    expect(seen).toEqual(new Set(['tạo gói mới thắng', 'bật lại gói cũ thắng']));
  });
});
