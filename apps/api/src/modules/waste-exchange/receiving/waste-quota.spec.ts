import type { Prisma } from '@prisma/client';
import { incrementPointUsage, pointUsage, staffConfirmedToday } from './waste-quota';

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ').trim();

describe('incrementPointUsage (§11.4)', () => {
  it('runs the single conditional upsert with the pre-checked amount and returns pointsUsed', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ pointsUsed: 60_000 }]);
    const tx = { $queryRaw } as unknown as Prisma.TransactionClient;
    await expect(incrementPointUsage(tx, 'p1', '2026-10', 60_000, 100_000)).resolves.toBe(60_000);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf($queryRaw.mock.calls[0]);
    expect(sql).toContain('INSERT INTO waste_point_usage ("pointId", "monthKey", "pointsUsed", confirmations) VALUES (?, ?, ?::int, 1)');
    expect(sql).toContain('ON CONFLICT ("pointId", "monthKey") DO UPDATE');
    expect(sql).toContain('confirmations = waste_point_usage.confirmations + 1');
    expect(sql).toContain('WHERE waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed" <= ?::int RETURNING "pointsUsed"');
    expect($queryRaw.mock.calls[0].slice(1)).toEqual(['p1', '2026-10', 60_000, 100_000]);
  });
  it('returns null without running SQL when points > quota (the INSERT branch has no WHERE, §11.4)', async () => {
    const $queryRaw = jest.fn();
    await expect(incrementPointUsage({ $queryRaw } as unknown as Prisma.TransactionClient, 'p1', '2026-10', 150_000, 100_000)).resolves.toBeNull();
    expect($queryRaw).not.toHaveBeenCalled();
  });
  it('returns null when the conditional update returns no row', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    await expect(incrementPointUsage({ $queryRaw } as unknown as Prisma.TransactionClient, 'p1', '2026-10', 41_000, 100_000)).resolves.toBeNull();
  });
  it.each([0, -1, 1.5])('throws a programming error for points=%p', async (pts) => {
    await expect(incrementPointUsage({ $queryRaw: jest.fn() } as unknown as Prisma.TransactionClient, 'p1', '2026-10', pts, 100_000)).rejects.toThrow();
  });
});

describe('pointUsage', () => {
  it('zeros when the month has no row', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    await expect(pointUsage({ wastePointUsage: { findUnique } } as unknown as Prisma.TransactionClient, 'p1', '2026-10')).resolves.toEqual({ pointsUsed: 0, confirmations: 0 });
    expect(findUnique).toHaveBeenCalledWith({ where: { pointId_monthKey: { pointId: 'p1', monthKey: '2026-10' } }, select: { pointsUsed: true, confirmations: true } });
  });
});

describe('staffConfirmedToday (§15.5 step 6)', () => {
  it('sums pointsAwarded of COMPLETED and REVERSED rows confirmed by the caller in the VN day', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { pointsAwarded: 22_000 } });
    const tx = { wasteRequest: { aggregate } } as unknown as Prisma.TransactionClient;
    await expect(staffConfirmedToday(tx, 's1', new Date('2026-10-17T18:30:00.000Z'))).resolves.toBe(22_000);
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        confirmedByUserId: 's1',
        status: { in: ['COMPLETED', 'REVERSED'] },
        completedAt: { gte: new Date('2026-10-17T17:00:00.000Z'), lt: new Date('2026-10-18T17:00:00.000Z') },
      },
      _sum: { pointsAwarded: true },
    });
  });
  it('0 when nothing was confirmed', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { pointsAwarded: null } });
    await expect(staffConfirmedToday({ wasteRequest: { aggregate } } as unknown as Prisma.TransactionClient, 's1', new Date())).resolves.toBe(0);
  });
});
