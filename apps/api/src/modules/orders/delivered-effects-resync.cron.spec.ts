import { DeliveredEffectsResyncCron } from './delivered-effects-resync.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from './order-status.service';

const NOW = new Date('2026-10-16T05:00:00.000Z');

type Row = { id: string; code: string; deliveredAt: Date };

/** findMany giả áp keyset (deliveredAt, id) và `take` trên danh sách đơn cố định. */
function make(rows: Row[], opts: { locked?: boolean; resync?: (id: string) => Promise<unknown> } = {}) {
  const sorted = [...rows].sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime() || a.id.localeCompare(b.id));
  const findMany = jest.fn(async (args: { where: { AND?: [unknown, { OR: [{ deliveredAt: { gt: Date } }, { deliveredAt: Date; id: { gt: string } }] }] }; take: number }) => {
    const keyset = args.where.AND?.[1].OR;
    const after = keyset ? { at: keyset[1].deliveredAt.getTime(), id: keyset[1].id.gt } : null;
    return sorted
      .filter((r) => !after || r.deliveredAt.getTime() > after.at || (r.deliveredAt.getTime() === after.at && r.id > after.id))
      .slice(0, args.take);
  });
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]) };
  const prisma = { order: { findMany }, $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const orderStatus = {
    resyncDeliveredEffects: jest.fn(opts.resync ?? (async () => ({ outcome: 'DONE', pointsCredited: true, commissionsLocked: 1 }))),
  };
  const cron = new DeliveredEffectsResyncCron(prisma as unknown as PrismaService, orderStatus as unknown as OrderStatusService);
  return { cron, findMany, orderStatus };
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `o${String(i).padStart(4, '0')}`, code: `TUBU${i}`, deliveredAt: new Date(NOW.getTime() - (n - i) * 60_000 - 3_600_000) }));

describe('DeliveredEffectsResyncCron', () => {
  it('chỉ quét đơn DELIVERED chưa có mốc, giao trong 14 ngày và quá 10 phút', async () => {
    const { cron, findMany } = make([]);
    await cron.resyncPending(NOW);
    const where = findMany.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where).toEqual({
      status: 'DELIVERED',
      deliveredEffectsAt: null,
      deliveredAt: { lt: new Date(NOW.getTime() - 10 * 60_000), gte: new Date(NOW.getTime() - 14 * 86_400_000) },
    });
  });

  it('mỗi lượt tối đa 200 đơn theo trang 50; lượt sau đi tiếp từ chỗ dừng rồi quay về đầu — đơn lỗi mãi không chặn đơn khác', async () => {
    const all = rows(260);
    const { cron, findMany, orderStatus } = make(all, { resync: async () => ({ outcome: 'INCOMPLETE', pointsCredited: false, commissionsLocked: 0, error: 'x' }) });
    await expect(cron.resyncPending(NOW)).resolves.toEqual({ scanned: 200, repaired: 0, failed: 200 });
    expect(findMany.mock.calls.every(([a]) => a.take <= 50)).toBe(true);
    expect(orderStatus.resyncDeliveredEffects.mock.calls.map(([id]) => id)).toEqual(all.slice(0, 200).map((r) => r.id));

    orderStatus.resyncDeliveredEffects.mockClear();
    await expect(cron.resyncPending(NOW)).resolves.toMatchObject({ scanned: 60 });
    expect(orderStatus.resyncDeliveredEffects.mock.calls.map(([id]) => id)).toEqual(all.slice(200).map((r) => r.id));

    orderStatus.resyncDeliveredEffects.mockClear();
    await cron.resyncPending(NOW);
    expect(orderStatus.resyncDeliveredEffects.mock.calls[0]?.[0]).toBe(all[0]?.id);
  });

  it('lỗi một đơn không dừng lượt; replica khác đang giữ khoá → bỏ lượt; handleCron không bao giờ ném', async () => {
    const { cron, orderStatus } = make(rows(3), {
      resync: async (id: string) => {
        if (id === 'o0001') throw new Error('deadlock detected');
        return { outcome: id === 'o0002' ? 'ALREADY_DONE' : 'DONE', pointsCredited: false, commissionsLocked: 0 };
      },
    });
    await expect(cron.resyncPending(NOW)).resolves.toEqual({ scanned: 3, repaired: 1, failed: 1 });
    expect(orderStatus.resyncDeliveredEffects).toHaveBeenCalledTimes(3);

    await expect(make(rows(3), { locked: false }).cron.resyncPending(NOW)).resolves.toEqual({ skipped: 'LOCKED' });

    const broken = make([]);
    (broken.cron as unknown as { prisma: { $transaction: () => Promise<never> } }).prisma.$transaction = () => Promise.reject(new Error('db down'));
    await expect(broken.cron.handleCron()).resolves.toBeUndefined();
  });
});
