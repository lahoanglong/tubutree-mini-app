import type { PrismaService } from '../../prisma/prisma.service';
import { COLLECTABLE_LIMIT, CouponCollectService } from './coupon-collect.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'THU10',
  title: 'Mừng bạn mới',
  type: 'PERCENT',
  value: 10,
  minOrder: 100_000,
  maxDiscount: 30_000,
  startAt: new Date('2026-11-01T00:00:00Z'),
  endAt: new Date('2026-11-30T16:59:59Z'),
  usageLimit: 100,
  newCustomerOnly: false,
  // Trường không được lộ ra ngoài.
  scopeMeta: { secret: 1 },
  createdById: 'admin-1',
  ...over,
});

function make(rows: unknown[], claimed: Record<string, number> = {}) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const groupBy = jest.fn().mockResolvedValue(Object.entries(claimed).map(([couponId, n]) => ({ couponId, _count: { _all: n } })));
  const prisma = { coupon: { findMany }, couponClaim: { groupBy } } as unknown as PrismaService;
  return { svc: new CouponCollectService(prisma), findMany, groupBy };
}

describe('CouponCollectService.collectable', () => {
  const NOW = new Date('2026-11-15T03:00:00Z');

  it('chỉ hỏi mã listed, đang bật, CLAIM chung (không thuộc lô), trong cửa sổ hiệu lực tính theo đúng thời điểm `now`', async () => {
    const { svc, findMany } = make([]);
    await svc.collectable(NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listed: true, isActive: true, scope: 'CLAIM', batch: null, startAt: { lte: NOW }, endAt: { gte: NOW } },
        orderBy: [{ endAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('mốc cuối ngày giờ Việt Nam: 23:59:59 +07 so theo thời điểm, không cắt ngày theo múi giờ máy chủ', async () => {
    const lastSecond = new Date('2026-11-30T16:59:59Z');
    const afterMidnight = new Date('2026-11-30T17:00:00Z');
    const a = make([]);
    await a.svc.collectable(lastSecond);
    expect(a.findMany.mock.calls[0]![0].where.endAt).toEqual({ gte: lastSecond });
    const b = make([]);
    await b.svc.collectable(afterMidnight);
    expect(b.findMany.mock.calls[0]![0].where.endAt).toEqual({ gte: afterMidnight });
  });

  it('gắn số đã nhận bằng một groupBy; không lộ id nội bộ, scopeMeta, người tạo', async () => {
    const { svc, groupBy } = make([row()], { c1: 40 });
    const out = await svc.collectable(NOW);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({ by: ['couponId'], where: { couponId: { in: ['c1'] } }, _count: { _all: true } });
    expect(out).toEqual([
      {
        code: 'THU10',
        title: 'Mừng bạn mới',
        type: 'PERCENT',
        value: 10,
        minOrder: 100_000,
        maxDiscount: 30_000,
        startAt: new Date('2026-11-01T00:00:00Z'),
        endAt: new Date('2026-11-30T16:59:59Z'),
        newCustomerOnly: false,
        claimedCount: 40,
        usageLimit: 100,
      },
    ]);
  });

  it('bỏ mã đã nhận đủ lượt; mã chưa ai nhận claimedCount 0; mã không giới hạn lượt vẫn giữ', async () => {
    const { svc } = make(
      [row({ id: 'full', code: 'FULL', usageLimit: 3 }), row({ id: 'fresh', code: 'FRESH' }), row({ id: 'open', code: 'OPEN', usageLimit: null })],
      { full: 3, open: 9999 },
    );
    const out = await svc.collectable(NOW);
    expect(out.map((c) => [c.code, c.claimedCount])).toEqual([
      ['FRESH', 0],
      ['OPEN', 9999],
    ]);
  });

  it('không có mã nào thì không gọi groupBy', async () => {
    const { svc, groupBy } = make([]);
    expect(await svc.collectable(NOW)).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('đọc tối đa COLLECTABLE_LIMIT mã', async () => {
    const { svc, findMany } = make([]);
    await svc.collectable(NOW);
    expect(findMany.mock.calls[0]![0].take).toBe(COLLECTABLE_LIMIT);
    expect(COLLECTABLE_LIMIT).toBe(50);
  });
});
