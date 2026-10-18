import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WasteReportsService } from '../../src/modules/waste-exchange/catalog/waste-reports.service';
import { createUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createWasteItem, createWastePoint, createWasteRequest, createWarehouse } from './fixtures/waste-fixtures';

/**
 * WasteReportsService.monthly on real Postgres: no lock is involved, so no race pair; the cases prove that the queries
 * and the Vietnam-time month convention (created by createdAt, units and points by completedAt, reversed by reversedAt,
 * quota from waste_point_usage) hold against the real schema. Every date sits in 2031-09 to 2031-11 so rows of other
 * specs never fall in these months.
 */
describe('waste-reports (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: WasteReportsService;
  let userId: string;
  let warehouseId: string;
  let itemId: string;
  let secondPointId: string | null = null;
  const usageKeys = [
    { monthKey: '2031-10', pointsUsed: 40_000, confirmations: 2 },
    { monthKey: '2031-09', pointsUsed: 7000, confirmations: 1 },
  ];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [WasteReportsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    reports = moduleRef.get(WasteReportsService);
    userId = (await createUser(prisma)).id;
    warehouseId = (await createWarehouse(prisma)).id;
    itemId = (await createWasteItem(prisma)).id;
  });

  afterEach(async () => {
    await prisma.pointsTransaction.deleteMany({ where: { userId } });
    await prisma.wasteRequest.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.wastePointUsage.deleteMany({ where: { pointId: warehouseId, monthKey: { in: usageKeys.map((u) => u.monthKey) } } });
    await cleanupWaste(prisma, { pointIds: secondPointId ? [secondPointId] : [], itemIds: [itemId] });
    await deleteItData(prisma, { userIds: [userId] });
    await moduleRef?.close();
  });

  async function request(over: { pointId?: string; createdAt: string; completedAt?: string; reversedAt?: string; status: 'COMPLETED' | 'REVERSED' }) {
    const row = await createWasteRequest(prisma, {
      userId,
      method: 'MAIL_IN',
      status: over.status,
      pointId: over.pointId ?? warehouseId,
      lines: [{ itemId, declaredQty: 10, receivedQty: 10 }],
    });
    await prisma.wasteRequest.update({
      where: { id: row.id },
      data: {
        createdAt: new Date(over.createdAt),
        completedAt: over.completedAt ? new Date(over.completedAt) : undefined,
        reversedAt: over.reversedAt ? new Date(over.reversedAt) : undefined,
      },
    });
    return row;
  }

  const ledger = (refType: 'RECYCLE' | 'RECYCLE_REVERSED', refId: string, delta: number) =>
    prisma.pointsTransaction.create({ data: { userId, delta, reason: `${refType}:${refId}`, refType, refId } });

  it('a request created on 30/09 and completed on 01/10 (Vietnam time) is created in September and credited in October', async () => {
    const row = await request({ status: 'COMPLETED', createdAt: '2031-09-30T16:59:00.000Z', completedAt: '2031-09-30T17:01:00.000Z' });
    await ledger('RECYCLE', row.id, 5000);

    const september = await reports.monthly('2031-09');
    const october = await reports.monthly('2031-10');

    expect(september.metrics.requestsCreatedByMethod.MAIL_IN).toBe(1);
    expect(september.metrics.pointsIssued).toBe(0);
    expect(october.metrics.requestsCreatedByMethod.MAIL_IN).toBe(0);
    expect(october.metrics.pointsIssued).toBe(5000);
  });

  it('points issued belong to the month of completion and points reversed to the month of the reversal', async () => {
    const row = await request({
      status: 'REVERSED',
      createdAt: '2031-10-09T03:00:00.000Z',
      completedAt: '2031-10-10T03:00:00.000Z',
      reversedAt: '2031-11-05T03:00:00.000Z',
    });
    await ledger('RECYCLE', row.id, 3000);
    await ledger('RECYCLE_REVERSED', row.id, -3000);

    const october = await reports.monthly('2031-10');
    const november = await reports.monthly('2031-11');

    expect(october.metrics.pointsIssued).toBe(3000);
    expect(october.metrics.pointsReversed).toBe(0);
    expect(november.metrics.pointsIssued).toBe(0);
    expect(november.metrics.pointsReversed).toBe(3000);
  });

  it('a point filter keeps only that point requests and reads quota usage of the month key', async () => {
    await prisma.wastePointUsage.deleteMany({ where: { pointId: warehouseId, monthKey: { in: usageKeys.map((u) => u.monthKey) } } });
    await prisma.wastePointUsage.createMany({ data: usageKeys.map((u) => ({ pointId: warehouseId, ...u })) });
    const second = await createWastePoint(prisma, { kind: 'PARTNER' });
    secondPointId = second.id;
    await request({ status: 'COMPLETED', createdAt: '2031-10-10T02:00:00.000Z', completedAt: '2031-10-10T03:00:00.000Z' });
    await request({ status: 'COMPLETED', pointId: second.id, createdAt: '2031-10-11T02:00:00.000Z', completedAt: '2031-10-11T03:00:00.000Z' });

    const filtered = await reports.monthly('2031-10', warehouseId);
    const all = await reports.monthly('2031-10');

    expect(filtered.pointId).toBe(warehouseId);
    expect(filtered.confirmations).toBe(1);
    expect(filtered.perPoint.map((p) => p.pointId)).toEqual([warehouseId]);
    expect(filtered.quotaUsed).toBe(40000);
    expect(all.confirmations).toBe(2);
    expect(all.perPoint.map((p) => p.pointId).sort()).toEqual([warehouseId, second.id].sort());
  });
});
