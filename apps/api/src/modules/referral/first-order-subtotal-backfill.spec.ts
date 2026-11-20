import { backfillFirstOrderSubtotal, FIRST_ORDER_VIRAL_LIVE_AT, subtotalSwitchCandidates } from './first-order-subtotal-backfill';
import type { FirstOrderOutcome } from './first-order-reward';

const since = FIRST_ORDER_VIRAL_LIVE_AT;

function db(ids: string[]) {
  return { order: { findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))) } };
}

describe('subtotalSwitchCandidates', () => {
  it('đơn lẻ đã giao từ lúc bật cờ của người có người mời, tiền hàng đạt mốc mà tổng trả dưới mốc (luật cũ bỏ qua), cũ trước', async () => {
    const d = db(['o1', 'o2']);
    expect(await subtotalSwitchCandidates(d as never, since, 199_000)).toEqual(['o1', 'o2']);
    expect(d.order.findMany).toHaveBeenCalledWith({
      where: {
        type: 'RETAIL',
        placedForCustomer: false,
        status: 'DELIVERED',
        deliveredAt: { gte: since },
        subtotal: { gte: 199_000 },
        total: { lt: 199_000 },
        user: { referredById: { not: null } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  });

  it('mốc bật cờ là 19/11/2026 23:13:49 giờ Việt Nam', () => {
    expect(FIRST_ORDER_VIRAL_LIVE_AT.toISOString()).toBe('2026-11-19T16:13:49.000Z');
  });
});

describe('backfillFirstOrderSubtotal', () => {
  it('chạy thử (mặc định): chỉ liệt kê đơn, không xét thưởng', async () => {
    const grant = jest.fn();
    const res = await backfillFirstOrderSubtotal({ db: db(['o1']) as never, grant }, { since, minOrder: 199_000, apply: false });
    expect(res).toEqual({ candidates: ['o1'], outcomes: {} });
    expect(grant).not.toHaveBeenCalled();
  });

  it('--apply: xét lần lượt từng đơn qua đường thưởng thật (idempotent) và đếm theo kết quả', async () => {
    const results: Record<string, FirstOrderOutcome> = {
      o1: { status: 'GRANTED', referrerId: 'R', refereeId: 'F', points: 100 },
      o2: { status: 'SKIPPED', reason: 'NOT_FIRST' },
      o3: { status: 'BLOCKED', reason: 'IP' },
      o4: { status: 'GRANTED', referrerId: 'R', refereeId: 'G', points: 100 },
    };
    const order: string[] = [];
    const grant = jest.fn(async (id: string) => {
      order.push(id);
      return results[id]!;
    });
    const res = await backfillFirstOrderSubtotal({ db: db(['o1', 'o2', 'o3', 'o4']) as never, grant }, { since, minOrder: 199_000, apply: true });
    expect(order).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(res.outcomes).toEqual({ GRANTED: 2, 'SKIPPED:NOT_FIRST': 1, 'BLOCKED:IP': 1 });
  });
});
