import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startOfVnDay, vnMonthKey } from '../../src/common/vn-time';
import { incrementPointUsage, pointUsage, staffConfirmedToday } from '../../src/modules/waste-exchange/receiving/waste-quota';
import { createUser, deleteItData, summarize, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWastePoint, createWasteRequest } from './fixtures/waste-fixtures';

let moduleRef: TestingModule;
let prisma: PrismaService;
const userIds: string[] = [];
const pointIds: string[] = [];
const itemIds: string[] = [];
const storefrontIds: string[] = [];
const monthKey = vnMonthKey();

async function partnerPoint() {
  const owner = await createUser(prisma);
  userIds.push(owner.id);
  const point = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id, quota: 100_000 });
  pointIds.push(point.id);
  if (point.createdStorefront) storefrontIds.push(point.ownerStorefrontId!);
  return point;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  await warmPool(prisma);
});

afterAll(async () => {
  await cleanupWaste(prisma, { pointIds, itemIds, storefrontIds });
  await deleteItData(prisma, { userIds });
  await moduleRef.close();
});

describe('waste point quota counter (real Postgres)', () => {
  it('quota SQL: 60000 on the first call, 100000 on the second, null when it would exceed (R18.3.23–25)', async () => {
    const p = await partnerPoint();
    await expect(prisma.$transaction((tx) => incrementPointUsage(tx, p.id, monthKey, 60_000, 100_000))).resolves.toBe(60_000);
    await expect(prisma.$transaction((tx) => incrementPointUsage(tx, p.id, monthKey, 40_000, 100_000))).resolves.toBe(100_000);
    await expect(prisma.$transaction((tx) => incrementPointUsage(tx, p.id, monthKey, 1, 100_000))).resolves.toBeNull();
    await expect(pointUsage(prisma, p.id, monthKey)).resolves.toEqual({ pointsUsed: 100_000, confirmations: 2 });
  });

  it('150000 on a quota of 100000 inserts nothing (R18.3.26)', async () => {
    const p = await partnerPoint();
    await expect(prisma.$transaction((tx) => incrementPointUsage(tx, p.id, monthKey, 150_000, 100_000))).resolves.toBeNull();
    await expect(prisma.wastePointUsage.count({ where: { pointId: p.id } })).resolves.toBe(0);
  });

  it('five concurrent increments of 30000 on quota 100000: exactly three succeed', async () => {
    const p = await partnerPoint();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => prisma.$transaction((tx) => incrementPointUsage(tx, p.id, monthKey, 30_000, 100_000))),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    const values = s.fulfilled.map((r) => r.value);
    expect(values.filter((v) => v !== null)).toHaveLength(3);
    expect(values.filter((v) => v === null)).toHaveLength(2);
    await expect(pointUsage(prisma, p.id, monthKey)).resolves.toEqual({ pointsUsed: 90_000, confirmations: 3 });
  });

  it('staffConfirmedToday counts COMPLETED and REVERSED of today only', async () => {
    const wh = await createWarehouse(prisma);
    const item = await createWasteItem(prisma);
    itemIds.push(item.id);
    const customer = await createUser(prisma);
    const staff = await createUser(prisma, { role: 'STAFF' });
    userIds.push(customer.id, staff.id);
    const now = new Date();
    const yesterday = new Date(startOfVnDay(now).getTime() - 1);
    const make = async (status: 'COMPLETED' | 'REVERSED' | 'REJECTED', pointsAwarded: number, completedAt: Date | null) => {
      const r = await createWasteRequest(prisma, {
        userId: customer.id,
        method: 'DROP_OFF',
        status: 'OPEN',
        pointId: wh.id,
        lines: [{ itemId: item.id, declaredQty: 1 }],
      });
      await prisma.wasteRequest.update({
        where: { id: r.id },
        data: {
          status,
          confirmedByUserId: staff.id,
          completedAt,
          closedAt: status === 'REJECTED' ? now : undefined,
          rejectionReason: status === 'REJECTED' ? 'WET' : undefined,
          pointsAwarded,
        },
      });
    };
    await make('COMPLETED', 10_000, now);
    await make('COMPLETED', 5_000, now);
    await make('REVERSED', 7_000, now);
    await make('REJECTED', 100_000, null);
    await make('COMPLETED', 50_000, yesterday);
    await expect(staffConfirmedToday(prisma, staff.id, new Date())).resolves.toBe(22_000);
  });
});
