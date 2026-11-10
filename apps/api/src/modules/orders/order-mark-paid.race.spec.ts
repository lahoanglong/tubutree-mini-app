import { ConflictException } from '@nestjs/common';
import { RaceDb } from '../../../test/fakes/race-db.fake';
import { OrderStatusService } from './order-status.service';

/**
 * Hai lời "đã nhận tiền" cho cùng một đơn (admin bấm đúp, admin + webhook Pancake, webhook gửi lại) phải chỉ lật PAID và chạy hệ quả MỘT lần;
 * một mã giao dịch ngân hàng không xác nhận được hai đơn; tiền về chen với lần huỷ đơn thì đúng một bên thắng. Dùng OrderStatusService.markPaid THẬT
 * trên cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá (test/fakes/race-db.fake.ts).
 */
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  total: 100_000,
  platform: 'miniapp',
  hasRecyclingPickup: false,
  pancakeAttention: null,
  paymentUnlinkedAt: null,
  paymentUnlinkedFirstAt: null,
  ...over,
});

function setup(orders: Record<string, unknown>[]) {
  const db = new RaceDb({
    order: {},
    orderStatusHistory: {},
    orderCustomerRefund: { unique: [{ fields: ['orderId', 'kind', 'refKey'] }] },
    dealerCreditLedger: {},
    analyticsEvent: {},
  });
  db.seed('order', orders);
  // Advisory lock theo mã giao dịch (lockBankRef): chỉ khoá khi chính câu SQL gọi pg_advisory_xact_lock.
  db.handlers.push({
    match: /pg_advisory_xact_lock/,
    run: (c) => c.lockKey(String(c.params[0])).then(() => 1),
  });
  const notifySafe = jest.fn().mockResolvedValue(true);
  const afterPaid = jest.fn().mockResolvedValue(undefined);
  const analytics = {
    // Ghi cùng tx như AnalyticsEventsService.record thật: rollback thì sự kiện biến mất theo.
    record: async (tx: any, e: { eventName: string; props: Record<string, unknown> }) => {
      await tx.analyticsEvent.create({
        data: { eventName: e.eventName, orderId: e.props.orderId },
      });
    },
  };
  const svc = new OrderStatusService(
    db.client,
    {} as never,
    {} as never,
    { notifySafe } as never,
    {} as never,
    undefined,
    analytics as never,
    { afterPaid } as never,
  );
  const history = () =>
    db.rows('orderStatusHistory').filter((h) => String(h.note).startsWith('Đã nhận tiền'));
  const events = (name: string) => db.rows('analyticsEvent').filter((e) => e.eventName === name);
  return { db, svc, notifySafe, afterPaid, history, events };
}

describe('OrderStatusService.markPaid — race', () => {
  // CONFIRMED + UNPAID (COD đã xác nhận rồi mới có tiền): trạng thái không đổi sau khi lật nên chỉ guard paymentStatus chặn lần lật thứ hai.
  it.each([
    ['PENDING_PAYMENT', 'CONFIRMED'],
    ['CONFIRMED', 'CONFIRMED'],
    ['PROCESSING', 'PROCESSING'],
  ] as const)(
    'admin + webhook Pancake + webhook gửi lại cùng lúc trên đơn %s: đúng MỘT lần lật PAID, một dòng lịch sử, một sự kiện order_paid, một tin, hai bên thua nhận ALREADY_PAID',
    async (from, to) => {
      const { db, svc, notifySafe, afterPaid, history, events } = setup([order({ status: from })]);
      const results = await Promise.all([
        svc.markPaid('o1', { actorType: 'ADMIN', actorId: 'admin1', note: 'Admin xác nhận' }),
        svc.markPaid('TUBU1', { actorType: 'PANCAKE', note: 'Pancake ghi nhận chuyển khoản' }),
        svc.markPaid('o1', { actorType: 'PANCAKE', note: 'Pancake gửi lại' }),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual([
        'ALREADY_PAID',
        'ALREADY_PAID',
        'PAID',
      ]);
      expect(db.row('order', 'o1')).toMatchObject({ paymentStatus: 'PAID', status: to });
      expect(history()).toHaveLength(1);
      expect(events('order_paid')).toHaveLength(1);
      expect(notifySafe).toHaveBeenCalledTimes(1);
      expect(afterPaid).toHaveBeenCalledTimes(1);
      expect(db.stats.lockWaits).toBeGreaterThan(0); // cả ba thật sự đụng nhau ở dòng đơn
    },
  );

  it('cùng một mã giao dịch xác nhận hai đơn khác nhau song song: một đơn PAID, đơn kia 409 và vẫn UNPAID (khoá advisory theo mã)', async () => {
    const { db, svc, history, events } = setup([order(), order({ id: 'o2', code: 'TUBU2' })]);
    const confirm = (id: string) =>
      svc.markPaid(id, {
        actorType: 'ADMIN',
        actorId: 'admin1',
        note: 'Admin xác nhận · Mã GD FT123',
        bankRef: 'FT123',
      });
    const settled = await Promise.allSettled([confirm('o1'), confirm('o2')]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ConflictException);
    expect((failed[0]!.reason as Error).message).toMatch(
      /^Mã giao dịch FT123 đã dùng để xác nhận đơn TUBU[12]\./,
    );
    const paid = db.rows('order').filter((o) => o.paymentStatus === 'PAID');
    expect(paid).toHaveLength(1);
    expect(db.rows('order').filter((o) => o.paymentStatus === 'UNPAID')).toHaveLength(1);
    expect(history()).toHaveLength(1);
    expect(events('order_paid')).toHaveLength(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
    expect(db.stats.rollbacks).toBeGreaterThan(0); // bên thua rollback, không để lại dấu
  });

  it.each([
    ['tiền về vào dòng đơn trước', 'pay', 'PAID'],
    ['lần huỷ vào dòng đơn trước', 'cancel', 'CLOSED'],
  ] as const)(
    'tiền về chen với lần huỷ đơn (%s): đúng một bên thắng, không bao giờ CANCELLED + PAID',
    async (_label, first, expected) => {
      const { db, svc } = setup([order()]);
      // Bên huỷ dùng đúng dạng guard của setStatus: chỉ lật khi trạng thái vẫn là cái đã đọc và còn UNPAID.
      const cancel = async () => {
        const seen = await db.client.order.findFirst({ where: { id: 'o1' } });
        const flip = await db.client.$transaction(async (tx: any) => {
          const res = await tx.order.updateMany({
            where: { id: 'o1', status: seen.status, paymentStatus: 'UNPAID' },
            data: { status: 'CANCELLED' },
          });
          // Như setStatus: sau câu lật còn ghi lịch sử trong cùng tx nên khoá dòng đơn được giữ qua nhiều câu.
          if (res.count === 1)
            await tx.orderStatusHistory.create({
              data: { orderId: 'o1', toStatus: 'CANCELLED', note: 'Huỷ' },
            });
          return res;
        });
        return flip.count === 1;
      };
      const pay = () => svc.markPaid('o1', { actorType: 'ADMIN', actorId: 'a1' });
      // Thứ tự gọi quyết định bên nào chạm khoá dòng trước (cả hai cùng đọc UNPAID/PENDING_PAYMENT rồi mới ghi).
      const [paid, cancelled] =
        first === 'pay'
          ? await Promise.all([pay(), cancel()])
          : (await Promise.all([cancel(), pay()])).reverse();
      const final = db.row('order', 'o1')!;
      expect(paid).toMatchObject({ outcome: expected });
      expect(cancelled).toBe(expected === 'CLOSED');
      expect(final).toMatchObject(
        expected === 'PAID'
          ? { status: 'CONFIRMED', paymentStatus: 'PAID' }
          : { status: 'CANCELLED', paymentStatus: 'UNPAID' },
      );
      expect(db.stats.lockWaits).toBeGreaterThan(0);
    },
  );
});
