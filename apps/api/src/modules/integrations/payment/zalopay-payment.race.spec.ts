import { RaceDb, tick } from '../../../../test/fakes/race-db.fake';
import { ZalopayService } from './zalopay.service';

/**
 * Callback ZaloPay, cron đối soát (tra trạng thái) và callback gửi lại cùng chạm một lần thanh toán: đơn chỉ lật PAID và chạy hệ quả MỘT lần;
 * khách trả bằng hai lệnh thì lệnh thua thành đúng MỘT khoản hoàn OVERPAYMENT (không phải lần PAID thứ hai); đơn bị huỷ chen giữa thì tiền thành
 * khoản hoàn LATE_PAYMENT chứ không bao giờ đơn CANCELLED + PAID. Dùng ZalopayService.applyGatewayPayment THẬT trên cơ sở dữ liệu giả có khoá dòng
 * (test/fakes/race-db.fake.ts).
 */
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'UNPAID',
  paymentMethod: 'ZALOPAY',
  paymentTxnId: null,
  total: 100_000,
  platform: 'miniapp',
  hasRecyclingPickup: false,
  placedForCustomer: false,
  endCustomerKey: null,
  shippingAddress: null,
  ...over,
});

const attempt = (id: string, appTransId: string, over: Record<string, unknown> = {}) => ({
  id,
  orderId: 'o1',
  provider: 'ZALOPAY',
  appTransId,
  amount: 100_000,
  succeededAt: null,
  resolvedAt: null,
  ...over,
});

function setup(attempts: Record<string, unknown>[], orderOver: Record<string, unknown> = {}) {
  const db = new RaceDb({
    order: {},
    paymentAttempt: { unique: [{ fields: ['appTransId'] }], relations: { order: { table: 'order', fk: 'orderId' } } },
    orderCustomerRefund: { unique: [{ fields: ['orderId', 'kind', 'refKey'] }] },
    analyticsEvent: {},
    user: {},
  });
  db.seed('order', [order(orderOver)]);
  db.seed('paymentAttempt', attempts);
  db.handlers.push({
    match: /SELECT 1 FROM "orders" WHERE "id"/,
    run: async (c) => {
      if (c.locking) await c.lockRow('order', c.params[0] as string);
      return [{ '?column?': 1 }];
    },
  });
  const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) };
  const afterPaid = jest.fn().mockResolvedValue(undefined);
  const analytics = {
    record: async (tx: any, e: { eventName: string; props: Record<string, unknown> }) => {
      await tx.analyticsEvent.create({ data: { eventName: e.eventName, orderId: e.props.orderId } });
    },
  };
  const config = { get: (k: string) => (k === 'ZALOPAY_ENDPOINT' ? 'https://zalopay.test' : `v-${k}`) };
  const svc = new ZalopayService(db.client, notifications as never, config as never, undefined, analytics as never, { afterPaid } as never);
  const refunds = () => db.rows('orderCustomerRefund');
  const paidEvents = () => db.rows('analyticsEvent').filter((e) => e.eventName === 'order_paid');
  return { db, svc, notifications, afterPaid, refunds, paidEvents };
}

describe('ZalopayService.applyGatewayPayment — race', () => {
  it('callback + cron đối soát + callback gửi lại cùng một app_trans_id: đúng MỘT lần PAID, một sự kiện, một tin, KHÔNG sinh khoản hoàn', async () => {
    const { db, svc, notifications, afterPaid, refunds, paidEvents } = setup([attempt('a1', 'T1')]);
    await Promise.all([
      svc.applyGatewayPayment('T1', 100_000, 'callback'),
      svc.applyGatewayPayment('T1', 100_000, 'query'),
      svc.applyGatewayPayment('T1', 100_000, 'callback'),
    ]);
    expect(db.row('order', 'o1')).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    expect(paidEvents()).toHaveLength(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(afterPaid).toHaveBeenCalledTimes(1);
    expect(refunds()).toHaveLength(0);
    expect(db.row('paymentAttempt', 'a1')!.succeededAt).toBeInstanceOf(Date);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('khách trả bằng hai lệnh, hai callback cùng lúc (mỗi lệnh gửi hai lần): một lệnh lật PAID, lệnh kia đúng MỘT khoản hoàn OVERPAYMENT', async () => {
    const { db, svc, notifications, refunds, paidEvents } = setup([attempt('a1', 'T1'), attempt('a2', 'T2')]);
    await Promise.all([
      svc.applyGatewayPayment('T1', 100_000, 'callback'),
      svc.applyGatewayPayment('T2', 100_000, 'callback'),
      svc.applyGatewayPayment('T2', 100_000, 'query'),
      svc.applyGatewayPayment('T1', 100_000, 'query'),
    ]);
    expect(db.row('order', 'o1')).toMatchObject({ paymentStatus: 'PAID' });
    expect(paidEvents()).toHaveLength(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const winner = db.rows('paymentAttempt').filter((a) => a.succeededAt);
    expect(winner).toHaveLength(1);
    const loserTrans = winner[0]!.appTransId === 'T1' ? 'T2' : 'T1';
    expect(refunds()).toHaveLength(1);
    expect(refunds()[0]).toMatchObject({ kind: 'OVERPAYMENT', refKey: `ZALOPAY:${loserTrans}`, amount: 100_000, status: 'PENDING', orderId: 'o1' });
  });

  it('huỷ đơn đã giữ khoá dòng trước khi callback tới: đơn vẫn CANCELLED + UNPAID, tiền thành đúng MỘT khoản hoàn LATE_PAYMENT, callback gửi lại không thêm', async () => {
    const { db, svc, notifications, afterPaid, refunds, paidEvents } = setup([attempt('a1', 'T1')]);
    let cancelApplied!: () => void;
    const applied = new Promise<void>((resolve) => (cancelApplied = resolve));
    const cancel = db.client.$transaction(async (tx: any) => {
      const res = await tx.order.updateMany({ where: { id: 'o1', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }, data: { status: 'CANCELLED' } });
      cancelApplied();
      // Như setStatus: sau câu lật còn ghi lịch sử trong cùng tx, khoá dòng đơn được giữ qua nhiều câu.
      for (let i = 0; i < 5; i++) await tick();
      return res.count;
    });
    await applied;
    // Callback đọc đơn khi lần huỷ CHƯA commit (vẫn thấy PENDING_PAYMENT) rồi mới đụng khoá ở câu lật.
    await Promise.all([cancel, svc.applyGatewayPayment('T1', 100_000, 'callback'), svc.applyGatewayPayment('T1', 100_000, 'query')]);
    expect(db.row('order', 'o1')).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    expect(paidEvents()).toHaveLength(0);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(afterPaid).not.toHaveBeenCalled();
    expect(refunds()).toHaveLength(1);
    expect(refunds()[0]).toMatchObject({ kind: 'LATE_PAYMENT', refKey: 'ZALOPAY:T1', amount: 100_000 });
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('callback và lần huỷ chạy sát nhau: đúng một bên thắng, không bao giờ CANCELLED + PAID, khoản hoàn chỉ có khi huỷ thắng', async () => {
    const { db, svc, refunds } = setup([attempt('a1', 'T1')]);
    const cancel = async () => {
      const seen = await db.client.order.findFirst({ where: { id: 'o1' } });
      const flip = await db.client.$transaction((tx: any) =>
        tx.order.updateMany({ where: { id: 'o1', status: seen.status, paymentStatus: 'UNPAID' }, data: { status: 'CANCELLED' } }),
      );
      return flip.count;
    };
    const [, cancelled] = await Promise.all([svc.applyGatewayPayment('T1', 100_000, 'callback'), cancel()]);
    const final = db.row('order', 'o1')!;
    expect(final.status === 'CANCELLED' && final.paymentStatus === 'PAID').toBe(false);
    expect(cancelled === 1 ? final.status === 'CANCELLED' && final.paymentStatus === 'UNPAID' : final.paymentStatus === 'PAID').toBe(true);
    expect(refunds().length).toBe(cancelled === 1 ? 1 : 0);
  });
});
