import type { Prisma } from '@prisma/client';
import { ReversalEffectsResyncCron } from './reversal-effects-resync.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from './order-status.service';

const NOW = new Date('2026-10-20T05:00:00.000Z');

type Row = { id: string; code: string; updatedAt: Date };

/** $queryRaw giả đọc tham số của câu SQL (cận trên, cận dưới, dấu keyset, take) rồi áp lên danh sách đơn cố định. */
function make(rows: Row[], opts: { locked?: boolean; resync?: (id: string) => Promise<unknown> } = {}) {
  const sorted = [...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id));
  const page = jest.fn(async (sql: Prisma.Sql) => {
    const v = sql.values as unknown[];
    const [upper, lower] = v as [Date, Date];
    const after = v.length === 5 ? { at: (v[2] as Date).getTime(), id: v[3] as string } : null;
    const take = v[v.length - 1] as number;
    return sorted
      .filter((r) => r.updatedAt < upper && r.updatedAt >= lower)
      .filter((r) => !after || r.updatedAt.getTime() > after.at || (r.updatedAt.getTime() === after.at && r.id > after.id))
      .slice(0, take);
  });
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]) };
  const prisma = { $queryRaw: page, $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const orderStatus = {
    resyncReversalEffects: jest.fn(opts.resync ?? (async () => ({ outcome: 'DONE' }))),
  };
  const cron = new ReversalEffectsResyncCron(prisma as unknown as PrismaService, orderStatus as unknown as OrderStatusService);
  return { cron, page, orderStatus, prisma };
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `o${String(i).padStart(4, '0')}`, code: `TUBU${i}`, updatedAt: new Date(NOW.getTime() - (n - i) * 60_000 - 3_600_000) }));

describe('ReversalEffectsResyncCron', () => {
  it('chỉ quét đơn CANCELLED/RETURNED chưa có mốc, cập nhật trong 14 ngày và quá 5 phút, bằng đúng vị từ của chỉ mục từng phần', async () => {
    const { cron, page } = make([]);
    await cron.resyncPending(NOW);
    const sql = page.mock.calls[0]![0];
    expect(sql.sql).toContain(`"reversalEffectsAt" IS NULL`);
    expect(sql.sql).toContain(`"status" IN ('CANCELLED', 'RETURNED')`);
    expect(sql.values[0]).toEqual(new Date(NOW.getTime() - 5 * 60_000));
    expect(sql.values[1]).toEqual(new Date(NOW.getTime() - 14 * 86_400_000));
  });

  it('mỗi lượt tối đa 200 đơn theo trang 50; lượt sau đi tiếp từ chỗ dừng rồi quay về đầu — đơn lỗi mãi không chặn đơn khác', async () => {
    const all = rows(260);
    const { cron, page, orderStatus } = make(all, { resync: async () => ({ outcome: 'INCOMPLETE', error: 'x' }) });
    await expect(cron.resyncPending(NOW)).resolves.toEqual({ scanned: 200, repaired: 0, failed: 200 });
    expect(page.mock.calls.every(([s]) => (s.values[s.values.length - 1] as number) <= 50)).toBe(true);
    expect(orderStatus.resyncReversalEffects.mock.calls.map(([id]) => id)).toEqual(all.slice(0, 200).map((r) => r.id));

    orderStatus.resyncReversalEffects.mockClear();
    await expect(cron.resyncPending(NOW)).resolves.toMatchObject({ scanned: 60 });
    expect(orderStatus.resyncReversalEffects.mock.calls.map(([id]) => id)).toEqual(all.slice(200).map((r) => r.id));

    orderStatus.resyncReversalEffects.mockClear();
    await cron.resyncPending(NOW);
    expect(orderStatus.resyncReversalEffects.mock.calls[0]?.[0]).toBe(all[0]?.id);
  });

  it('lỗi một đơn không dừng lượt; replica khác đang giữ khoá → bỏ lượt; handleCron không bao giờ ném', async () => {
    const { cron, orderStatus } = make(rows(3), {
      resync: async (id: string) => {
        if (id === 'o0001') throw new Error('deadlock detected');
        return { outcome: id === 'o0002' ? 'ALREADY_DONE' : 'DONE' };
      },
    });
    await expect(cron.resyncPending(NOW)).resolves.toEqual({ scanned: 3, repaired: 1, failed: 1 });
    expect(orderStatus.resyncReversalEffects).toHaveBeenCalledTimes(3);

    await expect(make(rows(3), { locked: false }).cron.resyncPending(NOW)).resolves.toEqual({ skipped: 'LOCKED' });

    const broken = make([]);
    (broken.cron as unknown as { prisma: { $transaction: () => Promise<never> } }).prisma.$transaction = () => Promise.reject(new Error('db down'));
    await expect(broken.cron.handleCron()).resolves.toBeUndefined();
  });

  it('lượt chạy chồng trong cùng tiến trình bị bỏ (RUNNING)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { cron } = make(rows(1), { resync: async () => (await gate, { outcome: 'DONE' }) });
    const first = cron.resyncPending(NOW);
    await expect(cron.resyncPending(NOW)).resolves.toEqual({ skipped: 'RUNNING' });
    release();
    await expect(first).resolves.toMatchObject({ scanned: 1, repaired: 1 });
  });
});
