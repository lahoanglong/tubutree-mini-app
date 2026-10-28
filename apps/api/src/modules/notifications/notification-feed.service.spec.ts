import { NotificationFeedService } from './notification-feed.service';
import type { PrismaService } from '../../prisma/prisma.service';

interface Row {
  id: string;
  userId: string;
  channel: string;
  status: string;
  sentAt: Date;
}

type Where = {
  userId?: string;
  channel?: string;
  status?: { not: string };
  sentAt?: { lt: Date };
  OR?: { sentAt: { lt: Date } | Date; id?: { lt: string } }[];
};

const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime();

/** Bộ giả của prisma.notificationLog: áp đúng where/orderBy/take mà service gửi xuống. */
function fakePrisma(rows: Row[]) {
  const matches = (r: Row, w: Where): boolean => {
    if (w.userId !== undefined && r.userId !== w.userId) return false;
    if (w.channel !== undefined && r.channel !== w.channel) return false;
    if (w.status?.not !== undefined && r.status === w.status.not) return false;
    if (w.sentAt && !(r.sentAt < w.sentAt.lt)) return false;
    if (w.OR && !w.OR.some((c) => {
      if (c.sentAt instanceof Date) return sameTime(r.sentAt, c.sentAt) && (c.id?.lt === undefined || r.id < c.id.lt);
      return r.sentAt < c.sentAt.lt;
    })) return false;
    return true;
  };
  const findMany = jest.fn(async ({ where, orderBy, take }: { where: Where; orderBy: { sentAt?: string; id?: string }[] | { sentAt?: string }; take: number }) => {
    expect(Array.isArray(orderBy) ? orderBy : [orderBy]).toEqual(expect.arrayContaining([{ sentAt: 'desc' }]));
    return rows
      .filter((r) => matches(r, where))
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, take);
  });
  const count = jest.fn(async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length);
  return { prisma: { notificationLog: { findMany, count } } as unknown as PrismaService, findMany, count };
}

const at = (iso: string) => new Date(iso);
const BASE = Date.parse('2026-10-01T00:00:00.000Z');
// 130 tin INAPP của u1; mỗi 3 tin chung một mốc giờ để thử tie-break theo id.
const seed = (): Row[] =>
  Array.from({ length: 130 }, (_, i) => ({
    id: `n${String(i).padStart(3, '0')}`,
    userId: 'u1',
    channel: 'INAPP',
    status: i % 4 === 0 ? 'READ' : 'SENT',
    sentAt: new Date(BASE + Math.floor(i / 3) * 1000),
  }));

describe('NotificationFeedService.list', () => {
  it('không tham số: đúng 50 tin mới nhất (take 50, chỉ tin INAPP của chính khách)', async () => {
    const rows = [...seed(), { id: 'z-zns', userId: 'u1', channel: 'ZNS', status: 'SENT', sentAt: at('2027-01-01T00:00:00.000Z') }, { id: 'z-u2', userId: 'u2', channel: 'INAPP', status: 'SENT', sentAt: at('2027-01-01T00:00:00.000Z') }];
    const { prisma, findMany } = fakePrisma(rows);
    const page = await new NotificationFeedService(prisma).list('u1', {});
    expect(page).toHaveLength(50);
    expect(page.every((r) => r.userId === 'u1' && r.channel === 'INAPP')).toBe(true);
    expect(findMany.mock.calls[0]![0].take).toBe(50);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ userId: 'u1', channel: 'INAPP' });
  });

  it('ba trang 20 tin nối bằng (before, beforeId): không trùng, không sót, theo đúng thứ tự', async () => {
    const rows = seed();
    const { prisma } = fakePrisma(rows);
    const svc = new NotificationFeedService(prisma);
    const all: Row[] = [];
    let cursor: { before?: string; beforeId?: string } = {};
    for (let i = 0; i < 3; i++) {
      const page = (await svc.list('u1', { ...cursor, limit: 20 })) as Row[];
      expect(page).toHaveLength(20);
      all.push(...page);
      const last = page[page.length - 1]!;
      cursor = { before: last.sentAt.toISOString(), beforeId: last.id };
    }
    const expected = [...rows].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || (a.id < b.id ? 1 : -1)).slice(0, 60);
    expect(all.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(new Set(all.map((r) => r.id)).size).toBe(60);
  });

  it('cùng sentAt nằm vắt qua ranh giới hai trang vẫn không trùng không sót (sắp thứ hai theo id)', async () => {
    const same = at('2026-10-02T00:00:00.000Z');
    const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, userId: 'u1', channel: 'INAPP', status: 'SENT', sentAt: same }));
    const { prisma } = fakePrisma(rows);
    const svc = new NotificationFeedService(prisma);
    const p1 = (await svc.list('u1', { limit: 2 })) as Row[];
    expect(p1.map((r) => r.id)).toEqual(['e', 'd']);
    const p2 = (await svc.list('u1', { before: p1[1]!.sentAt.toISOString(), beforeId: p1[1]!.id, limit: 2 })) as Row[];
    expect(p2.map((r) => r.id)).toEqual(['c', 'b']);
    const p3 = (await svc.list('u1', { before: p2[1]!.sentAt.toISOString(), beforeId: p2[1]!.id, limit: 2 })) as Row[];
    expect(p3.map((r) => r.id)).toEqual(['a']);
  });

  it('limit lớn hơn 50 bị chặn ở 50; limit nhỏ hơn 1 về 1', async () => {
    const { prisma, findMany } = fakePrisma(seed());
    const svc = new NotificationFeedService(prisma);
    await svc.list('u1', { limit: 500 });
    await svc.list('u1', { limit: 0 });
    expect(findMany.mock.calls.map((c) => c[0].take)).toEqual([50, 1]);
  });

  it('chỉ before (không beforeId): lấy các tin cũ hơn mốc đó', async () => {
    const rows = seed();
    const { prisma } = fakePrisma(rows);
    const cut = rows[60]!.sentAt;
    const page = (await new NotificationFeedService(prisma).list('u1', { before: cut.toISOString() })) as Row[];
    expect(page.every((r) => r.sentAt < cut)).toBe(true);
  });
});

describe('NotificationFeedService.unreadCount', () => {
  it('đếm TOÀN BỘ tin INAPP chưa đọc của khách (không giới hạn 50), bỏ tin ZNS và tin của người khác', async () => {
    const rows = [...seed(), { id: 'zz', userId: 'u1', channel: 'ZNS', status: 'SENT', sentAt: at('2026-10-05T00:00:00.000Z') }, { id: 'u2n', userId: 'u2', channel: 'INAPP', status: 'SENT', sentAt: at('2026-10-05T00:00:00.000Z') }];
    const { prisma, count } = fakePrisma(rows);
    const unread = rows.filter((r) => r.userId === 'u1' && r.channel === 'INAPP' && r.status !== 'READ').length;
    expect(unread).toBeGreaterThan(50);
    await expect(new NotificationFeedService(prisma).unreadCount('u1')).resolves.toEqual({ count: unread });
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u1', channel: 'INAPP', status: { not: 'READ' } } });
  });
});
