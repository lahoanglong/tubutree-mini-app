import { friendKnownFor, orderZaloFriendCard } from './order-zalo-friend-card';
import type { OrderZaloGate } from '../../system-config/order-zalo-config';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-26T03:00:00.000Z');
const ON: OrderZaloGate = { enabled: true, open: true, rolloutPct: 100 };

type Row = { orderId: string; userId: string; recipientRole: string; status: string; resultReason: string | null; resultAt: Date | null };
type Where = {
  orderId?: string;
  order?: { userId: string };
  recipientRole: string;
  status: string;
  resultReason: null;
  resultAt?: { gte: Date };
};

/** Bộ giả áp đúng `where` mà helper gửi xuống, để ca test chứng minh luật chứ không chỉ chứng minh lời gọi. */
function outbox(rows: Row[]) {
  const findFirst = jest.fn(async ({ where }: { where: Where }) => {
    const hit = rows.find(
      (r) =>
        (where.orderId === undefined || r.orderId === where.orderId) &&
        (where.order === undefined || r.userId === where.order.userId) &&
        r.recipientRole === where.recipientRole &&
        r.status === where.status &&
        r.resultReason === where.resultReason &&
        (where.resultAt === undefined || (r.resultAt !== null && r.resultAt >= where.resultAt.gte)),
    );
    return hit ? { id: 'r1' } : null;
  });
  return { prisma: { mssOrderEventOutbox: { findFirst } } as never, findFirst };
}

const ORDER = { id: 'o1', userId: 'u1', status: 'PENDING_PAYMENT', orderZaloConsent: true as boolean | null };
const sent = (over: Partial<Row> = {}): Row => ({
  orderId: 'o1',
  userId: 'u1',
  recipientRole: 'buyer',
  status: 'RESULT_SENT',
  resultReason: null,
  resultAt: new Date(NOW - DAY),
  ...over,
});

describe('friendKnownFor', () => {
  it('RESULT_SENT lý do null của người mua trong 90 ngày: true; truy vấn theo chủ đơn, đúng mốc 90 ngày tính từ `now`', async () => {
    const { prisma, findFirst } = outbox([sent({ orderId: 'o-khac' })]);
    expect(await friendKnownFor(prisma, 'u1', NOW)).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { order: { userId: 'u1' }, recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null, resultAt: { gte: new Date(NOW - 90 * DAY) } },
      select: { id: true },
    });
  });

  it.each<[string, Partial<Row>]>([
    ['tin người lạ (stranger)', { resultReason: 'stranger' }],
    ['quá 90 ngày', { resultAt: new Date(NOW - 91 * DAY) }],
    ['dòng người nhận', { recipientRole: 'recipient' }],
    ['bị bỏ qua (not_friend)', { status: 'RESULT_SKIPPED', resultReason: 'not_friend' }],
    ['không rõ kết quả', { status: 'RESULT_UNKNOWN' }],
    ['khách khác', { userId: 'u2' }],
  ])('%s: false', async (_n, over) => {
    expect(await friendKnownFor(outbox([sent(over)]).prisma, 'u1', NOW)).toBe(false);
  });
});

describe('orderZaloFriendCard', () => {
  it.each(['order', 'account'] as const)('%s: chưa có tin bạn bè nào → hiện', async (scope) => {
    expect(await orderZaloFriendCard(outbox([]).prisma, ON, ORDER, scope, NOW)).toBe(true);
  });

  it.each(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'])('đơn đang đi (%s): hiện', async (status) => {
    expect(await orderZaloFriendCard(outbox([]).prisma, ON, { ...ORDER, status }, 'account', NOW)).toBe(true);
  });

  it.each<[string, OrderZaloGate | null | undefined, Partial<typeof ORDER>]>([
    ['cờ tắt', { enabled: false, open: false, rolloutPct: 0 }, {}],
    ['MSS chưa công bố order_events', { ...ON, open: false }, {}],
    ['tỉ lệ 0', { ...ON, rolloutPct: 0 }, {}],
    ['không có MssModule', undefined, {}],
    ['cổng chưa nạp (null)', null, {}],
    ['khách không đồng ý', ON, { orderZaloConsent: false }],
    ['chưa hỏi đồng ý', ON, { orderZaloConsent: null }],
    ['đơn đã giao', ON, { status: 'DELIVERED' }],
    ['đơn đã huỷ', ON, { status: 'CANCELLED' }],
    ['đơn đã trả', ON, { status: 'RETURNED' }],
  ])('%s: không hiện và không truy vấn outbox (dò 4 giây/lần không tốn truy vấn)', async (_n, gate, over) => {
    for (const scope of ['order', 'account'] as const) {
      const { prisma, findFirst } = outbox([]);
      expect(await orderZaloFriendCard(prisma, gate, { ...ORDER, ...over }, scope, NOW)).toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    }
  });

  describe("scope 'order' (khách vãng lai): chỉ tin của đơn này", () => {
    it('đúng một truy vấn theo orderId, không mốc thời gian', async () => {
      const { prisma, findFirst } = outbox([]);
      await orderZaloFriendCard(prisma, ON, ORDER, 'order', NOW);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({
        where: { orderId: 'o1', recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null },
        select: { id: true },
      });
    });

    it('MSS đã nhắn đơn này như bạn bè: ẩn', async () => {
      expect(await orderZaloFriendCard(outbox([sent()]).prisma, ON, ORDER, 'order', NOW)).toBe(false);
    });

    it.each<[string, Partial<Row>]>([
      ['tin bạn bè của đơn khác cùng khách', { orderId: 'o-khac' }],
      ['tin người lạ của đơn này', { resultReason: 'stranger' }],
      ['tin bị bỏ qua (stranger_cap)', { status: 'RESULT_SKIPPED', resultReason: 'stranger_cap' }],
      ['dòng người nhận', { recipientRole: 'recipient' }],
    ])('%s: vẫn hiện', async (_n, over) => {
      expect(await orderZaloFriendCard(outbox([sent(over)]).prisma, ON, ORDER, 'order', NOW)).toBe(true);
    });
  });

  describe("scope 'account' (khách đăng nhập): xét cả lịch sử 90 ngày của chủ đơn", () => {
    it('tin bạn bè của đơn khác cùng khách trong 90 ngày: ẩn; đúng một truy vấn', async () => {
      const { prisma, findFirst } = outbox([sent({ orderId: 'o-khac' })]);
      expect(await orderZaloFriendCard(prisma, ON, ORDER, 'account', NOW)).toBe(false);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it('tin bạn bè của chính đơn này: ẩn', async () => {
      expect(await orderZaloFriendCard(outbox([sent()]).prisma, ON, ORDER, 'account', NOW)).toBe(false);
    });

    it.each<[string, Partial<Row>]>([
      ['chỉ có tin người lạ', { orderId: 'o-khac', resultReason: 'stranger' }],
      ['tin bạn bè quá 90 ngày', { orderId: 'o-khac', resultAt: new Date(NOW - 91 * DAY) }],
      ['tin bạn bè của khách khác', { orderId: 'o-khac', userId: 'u2' }],
    ])('%s: vẫn hiện', async (_n, over) => {
      expect(await orderZaloFriendCard(outbox([sent(over)]).prisma, ON, ORDER, 'account', NOW)).toBe(true);
    });
  });
});
