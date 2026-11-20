import { FIRST_ORDER_BLOCKED_EVENT, firstOrderGuardStats, recordFirstOrderBlocked } from './first-order-guard-stats';
import { FIRST_ORDER_REFERRER_PREFIX } from './first-order-reward';

const since = new Date('2026-11-11T17:00:00.000Z');
const until = new Date('2026-11-18T15:00:00.000Z');

describe('recordFirstOrderBlocked', () => {
  it('một dòng sự kiện hệ thống, eventId cố định theo đơn và bỏ qua dòng trùng: xét lại cùng đơn không đếm thêm', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const at = new Date('2026-11-18T10:00:00.000Z');
    await recordFirstOrderBlocked({ analyticsEvent: { createMany } } as never, 'o1', 'IP', at);
    await recordFirstOrderBlocked({ analyticsEvent: { createMany } } as never, 'o1', 'IP', at);
    expect(createMany).toHaveBeenCalledTimes(2);
    for (const [arg] of createMany.mock.calls) {
      expect(arg).toEqual({
        data: [{ eventId: `${FIRST_ORDER_BLOCKED_EVENT}:o1`, eventName: FIRST_ORDER_BLOCKED_EVENT, platform: 'system', occurredAt: at, props: { orderId: 'o1', reason: 'IP' } }],
        skipDuplicates: true,
      });
    }
  });
});

describe('firstOrderGuardStats', () => {
  function db(rows: unknown[], rewarded = 0) {
    return {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      pointsTransaction: { count: jest.fn().mockResolvedValue(rewarded) },
    };
  }

  it('số đã thưởng đếm dòng sổ của người mời trong kỳ; số chặn theo lý do (bigint thành number), lý do lạ bỏ qua, lý do vắng là 0', async () => {
    const d = db(
      [
        { reason: 'IP', n: 7n },
        { reason: 'PHONE', n: 2n },
        { reason: 'LẠ', n: 5n },
        { reason: null, n: 1n },
      ],
      12,
    );
    expect(await firstOrderGuardStats(d as never, since, until)).toEqual({
      rewarded: 12,
      blocked: { SELF: 0, PHONE: 2, ZALO: 0, ADDRESS: 0, IP: 7 },
    });
    expect(d.pointsTransaction.count).toHaveBeenCalledWith({
      where: { refType: 'REFERRAL', reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX }, createdAt: { gte: since, lte: until } },
    });
    const call = d.$queryRaw.mock.calls[0]!;
    expect((call[0] as TemplateStringsArray).join('?')).toContain('"eventName" = ?');
    expect(call).toEqual(expect.arrayContaining([FIRST_ORDER_BLOCKED_EVENT, since.toISOString(), until.toISOString()]));
  });

  it('chưa có gì: mọi số là 0', async () => {
    expect(await firstOrderGuardStats(db([]) as never, since, until)).toEqual({ rewarded: 0, blocked: { SELF: 0, PHONE: 0, ZALO: 0, ADDRESS: 0, IP: 0 } });
  });
});
