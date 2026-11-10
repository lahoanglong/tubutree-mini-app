import { HttpException } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Cron tạo đơn kỳ của gói định kỳ chạy đồng thời (nhiều instance, hoặc cron chạm tay khách bấm Tạm dừng/Huỷ), Postgres READ COMMITTED
 * (xem test/fakes/race-db.fake.ts): một kỳ chỉ ra MỘT đơn, Ví chỉ bị trừ một lần, kho giữ chỗ một lần, và gói đã Tạm dừng/Huỷ thì không ra đơn.
 * Dùng SubscriptionsService + WalletLedgerService THẬT; chỉ cơ sở dữ liệu và các dịch vụ giá/thông báo được giả.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);

const UNIT = 50_000;
const QTY = 2;
const CYCLE_TOTAL = 88_000; // 100.000đ giảm 12% (bậc mặc định), phí giao 0
const DAY = 86_400_000;
const INTERVAL = 4 * 7 * DAY; // intervalWeeks của gói seed

function setup() {
  const db = new RaceDb({
    subscription: {},
    variation: { relations: { product: { table: 'product', fk: 'productId' } } },
    product: {},
    address: {},
    user: {},
    order: { unique: [{ fields: ['idempotencyKey'] }, { fields: ['code'] }] },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    analyticsEvent: {},
  });
  const yesterday = new Date(Date.now() - 36 * 3600e3);
  db.seed('subscription', [
    {
      id: 's1',
      userId: 'u1',
      variationId: 'v1',
      addressId: 'a1',
      quantity: QTY,
      status: 'ACTIVE',
      paymentMethod: 'WALLET',
      intervalWeeks: 4,
      nextRunAt: yesterday,
      lastOrderId: null,
      retryCount: 0,
    },
  ]);
  db.seed('variation', [{ id: 'v1', name: 'Hộp', isActive: true, pancakeId: 'pk1', productId: 'p1', salePrice: null, retailPrice: UNIT, stock: 10, reservedStock: 0 }]);
  db.seed('product', [{ id: 'p1', name: 'Sữa', slug: 'sua', isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU', storefrontId: null }]);
  db.seed('address', [{ id: 'a1', userId: 'u1', recipient: 'An', phone: '0900000000', province: 'HCM', district: 'Q1', ward: 'P1', street: '1 Lê Lợi', provinceCode: 1, districtCode: 1, wardCode: 1 }]);
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
      // lockSubscription: khoá dòng rồi đọc bản mới nhất dưới khoá (cột paymentMethod::text là enum đã ép chuỗi).
      match: /FROM "subscriptions" WHERE "id" = \?/,
      run: async (c) => {
        if (c.locking) await c.lockRow('subscription', c.params[0] as string);
        const r = c.rows('subscription').find((x) => x.id === c.params[0]);
        return r ? [r] : [];
      },
    },
    {
      // reserveVariationStock: UPDATE có điều kiện stock >= số lượng; khoá dòng, xét lại điều kiện trên bản mới nhất.
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
    record: async (tx: any, e: { eventName: string }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName } });
    },
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SubscriptionsService(db.client, config as never, pricing as never, loyalty as never, notifications as never, pancakeOrder as never, analytics as never, new WalletLedgerService());
  const orders = () => db.rows('order');
  const wallet = () => db.row('user', 'u1')!.walletBalance as number;
  const ledger = () => db.rows('walletTransaction');
  const variation = () => db.row('variation', 'v1')!;
  return { db, svc, orders, wallet, ledger, variation, pancakeOrder };
}

describe('SubscriptionsService cycle — race', () => {
  it('hai instance cron cùng quét một gói đến hạn: đúng MỘT đơn kỳ, Ví trừ một lần, kho giữ chỗ một lần, kỳ kế dời đúng một chu kỳ', async () => {
    const { db, svc, orders, wallet, ledger, variation, pancakeOrder } = setup();
    await Promise.all([svc.processDue(), svc.processDue(), svc.processDue()]);
    expect(orders()).toHaveLength(1);
    expect(orders()[0]).toMatchObject({ userId: 'u1', paymentMethod: 'WALLET', paymentStatus: 'PAID', total: CYCLE_TOTAL, subscriptionId: 's1' });
    expect(wallet()).toBe(500_000 - CYCLE_TOTAL);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ type: 'ORDER_PAY', delta: -CYCLE_TOTAL, refId: orders()[0]!.id });
    expect(variation()).toMatchObject({ stock: 10 - QTY, reservedStock: QTY });
    expect(pancakeOrder.enqueuePush).toHaveBeenCalledTimes(1);
    const sub = db.row('subscription', 's1')!;
    expect(sub.lastOrderId).toBe(orders()[0]!.id);
    expect(sub.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
  });

  // Một lần ghi cũ (khách bấm Bỏ qua kỳ / Tiếp tục từ bản đọc trước lúc cron claim) có thể trả nextRunAt về mốc cũ: cron sau claim lại ĐÚNG kỳ đó.
  // Khoá idempotencyKey theo (gói, kỳ) là chốt cuối ở DB: lần ghi đơn thứ hai rollback hết (đơn, kho, Ví), cron không thử lại.
  it('nextRunAt bị ghi cũ kéo ngược về kỳ đã ra đơn rồi cron quét lại: vẫn MỘT đơn, Ví trừ một lần, kho giữ chỗ một lần', async () => {
    const { db, svc, orders, wallet, ledger, variation, pancakeOrder } = setup();
    const due = db.row('subscription', 's1')!.nextRunAt as Date;
    await svc.processDue();
    expect(orders()).toHaveLength(1);
    await db.client.subscription.update({ where: { id: 's1' }, data: { nextRunAt: due } });
    await Promise.all([svc.processDue(), svc.processDue()]);
    expect(orders()).toHaveLength(1);
    expect(wallet()).toBe(500_000 - CYCLE_TOTAL);
    expect(ledger()).toHaveLength(1);
    expect(variation()).toMatchObject({ stock: 10 - QTY, reservedStock: QTY });
    expect(pancakeOrder.enqueuePush).toHaveBeenCalledTimes(1);
    expect(db.stats.rollbacks).toBeGreaterThan(0);
  });

  // setStatus/skipCycle ghi CÓ ĐIỀU KIỆN theo bản vừa đọc (status + nextRunAt): cron claim chen giữa thì khách nhận 409 và gói giữ nguyên
  // ACTIVE với kỳ đã ra đơn; ghi theo id thì lệnh của khách trả nextRunAt về mốc cũ (lịch lệch) trong khi đơn kỳ đó vẫn ra.
  it.each(['PAUSED', 'CANCELLED'] as const)(
    'cron chen với khách bấm %s (quét thời điểm): khách thắng thì gói đúng trạng thái đã chọn, thua thì 409 và kỳ đó ra đúng một đơn; lịch không bị kéo ngược',
    async (target) => {
      const seen = new Set<string>();
      for (let skew = -40; skew <= 40; skew++) {
        const { db, svc, orders, wallet, ledger, variation } = setup();
        const cron = async () => (await delay(Math.max(skew, 0)), svc.processDue());
        const act = async () => (await delay(Math.max(-skew, 0)), svc.setStatus('u1', 's1', target));
        const [ranCron, acted] = await Promise.allSettled([cron(), act()]);
        const label = `skew ${skew}`;
        is(label, ranCron.status, 'fulfilled');
        const n = orders().length;
        const sub = db.row('subscription', 's1')!;
        if (acted.status === 'fulfilled') {
          is(label, sub.status, target);
        } else {
          is(label, httpStatus(acted), 409);
          is(label, sub.status, 'ACTIVE');
          is(label, n, 1);
        }
        if (n === 1) is(label, sub.nextRunAt.getTime() > Date.now() + 20 * DAY, true); // kỳ đã ra đơn thì lịch ở kỳ kế, không bị ghi cũ kéo ngược
        is(label, n <= 1, true);
        is(label, wallet(), 500_000 - CYCLE_TOTAL * n);
        is(label, ledger().length, n);
        is(label, variation().stock, 10 - QTY * n);
        is(label, variation().reservedStock, QTY * n);
        seen.add(`${n} đơn, khách ${acted.status}`);
      }
      expect(seen).toEqual(new Set(['0 đơn, khách fulfilled', '1 đơn, khách fulfilled', '1 đơn, khách rejected']));
    },
  );

  it('khách bấm Bỏ qua kỳ chen với cron claim (quét thời điểm): bỏ qua thắng thì kỳ đó KHÔNG ra đơn, thua thì 409; không bao giờ báo đã bỏ qua mà đơn kỳ đó vẫn ra', async () => {
    const seen = new Set<string>();
    for (let skew = -40; skew <= 40; skew++) {
      const { db, svc, orders, wallet, ledger, variation } = setup();
      const due = (db.row('subscription', 's1')!.nextRunAt as Date).getTime();
      const cron = async () => (await delay(Math.max(skew, 0)), svc.processDue());
      const act = async () => (await delay(Math.max(-skew, 0)), svc.skipCycle('u1', 's1'));
      const [ranCron, skipped] = await Promise.allSettled([cron(), act()]);
      const label = `skew ${skew}`;
      is(label, ranCron.status, 'fulfilled');
      const n = orders().length;
      const sub = db.row('subscription', 's1')!;
      const next = sub.nextRunAt.getTime();
      is(label, sub.status, 'ACTIVE');
      if (skipped.status === 'fulfilled') {
        // Bỏ qua thắng cron: lịch dời một chu kỳ từ kỳ đến hạn và kỳ đó không ra đơn. Cron claim trước thì khách bỏ qua kỳ KẾ (một chu kỳ nữa).
        if (n === 0) is(label, next, due + INTERVAL);
        else is(label, next > Date.now() + 40 * DAY, true);
      } else {
        is(label, httpStatus(skipped), 409);
        is(label, n, 1);
        is(label, next > Date.now() + 20 * DAY && next < Date.now() + 40 * DAY, true); // chỉ có dời của cron claim
      }
      is(label, n <= 1, true);
      is(label, wallet(), 500_000 - CYCLE_TOTAL * n);
      is(label, ledger().length, n);
      is(label, variation().stock, 10 - QTY * n);
      is(label, variation().reservedStock, QTY * n);
      seen.add(`${n} đơn, bỏ qua ${skipped.status}`);
    }
    expect(seen).toEqual(new Set(['0 đơn, bỏ qua fulfilled', '1 đơn, bỏ qua fulfilled', '1 đơn, bỏ qua rejected']));
  });
});
