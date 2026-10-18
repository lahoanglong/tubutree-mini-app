import { BadRequestException } from '@nestjs/common';
import { WASTE_REJECTION_REASON_VALUES } from '@tubutree/shared-types';
import {
  buildWasteMonthMetrics,
  vnMonthRange,
  WasteReportsService,
  type WasteMonthlyReport,
  type WasteMonthRows,
} from './waste-reports.service';

const iso = (s: string) => new Date(s);

const rows: WasteMonthRows = {
  created: [
    { method: 'DROP_OFF', status: 'COMPLETED', rejectionReason: null },
    { method: 'DROP_OFF', status: 'REJECTED', rejectionReason: 'WET' },
    { method: 'DROP_OFF', status: 'OPEN', rejectionReason: null },
    { method: 'MAIL_IN', status: 'COMPLETED', rejectionReason: null },
    { method: 'MAIL_IN', status: 'EXPIRED', rejectionReason: null },
    { method: 'PICKUP', status: 'REVERSED', rejectionReason: null },
  ],
  completed: [
    {
      id: 'R1',
      userId: 'U1',
      method: 'DROP_OFF',
      pointId: 'P1',
      pointName: 'Tạp hoá Cô Ba',
      createdAt: iso('2026-10-20T03:00:00.000Z'),
      completedAt: iso('2026-10-20T05:00:00.000Z'),
      carrierCostVnd: null,
      receivedWeightGrams: 3200,
      lines: [
        { itemId: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 10, receivedQty: 10, gramsPerUnit: 300 },
        { itemId: 'HOP_SUA', itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', declaredQty: 20, receivedQty: 16, gramsPerUnit: 10 },
      ],
    },
    {
      id: 'R2',
      userId: 'U2',
      method: 'MAIL_IN',
      pointId: 'WH',
      pointName: 'Kho Tubu HCM',
      createdAt: iso('2026-09-30T05:00:00.000Z'),
      completedAt: iso('2026-10-05T05:00:00.000Z'),
      carrierCostVnd: 5000,
      receivedWeightGrams: null,
      lines: [{ itemId: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 8, receivedQty: 8, gramsPerUnit: 300 }],
    },
    {
      id: 'R3',
      userId: 'U3',
      method: 'PICKUP',
      pointId: 'WH',
      pointName: 'Kho Tubu HCM',
      createdAt: iso('2026-10-10T00:00:00.000Z'),
      completedAt: iso('2026-10-11T06:00:00.000Z'),
      carrierCostVnd: 22000,
      receivedWeightGrams: 1300,
      lines: [{ itemId: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 6, receivedQty: 4, gramsPerUnit: 300 }],
    },
  ],
  issued: [
    { refId: 'R1', delta: 7000 },
    { refId: 'R2', delta: 4000 },
    { refId: 'R3', delta: 2000 },
    { refId: 'OTHER', delta: 99_000 },
  ],
  reversed: [{ id: 'R3', pointId: 'WH', pointName: 'Kho Tubu HCM', taken: 2000 }],
  expiredCount: 1,
  partnerPoints: [
    { id: 'P1', name: 'Tạp hoá Cô Ba', monthlyQuotaPoints: 100_000 },
    { id: 'P2', name: 'Cô Tư', monthlyQuotaPoints: 300_000 },
  ],
  usage: [{ pointId: 'P1', pointsUsed: 7000, confirmations: 1 }],
  completedLast60d: [
    { userId: 'U1', completedAt: iso('2026-09-01T03:00:00.000Z') },
    { userId: 'U1', completedAt: iso('2026-10-20T05:00:00.000Z') },
    { userId: 'U2', completedAt: iso('2026-07-01T03:00:00.000Z') },
    { userId: 'U2', completedAt: iso('2026-10-05T05:00:00.000Z') },
    { userId: 'U3', completedAt: iso('2026-10-11T06:00:00.000Z') },
  ],
  ordersOfExchangers: 5,
  ordersOfNonExchangers: 12,
};

const fixtureReport: WasteMonthlyReport = { month: '2026-10', pointId: null, ...buildWasteMonthMetrics(rows), confirmations: 3, quotaUsed: 7000 };

describe('buildWasteMonthMetrics (fixture of October 2026)', () => {
  const { metrics } = fixtureReport;

  it('requestsCreatedByMethod counts the created cohort per method', () => {
    expect(metrics.requestsCreatedByMethod).toEqual({ DROP_OFF: 3, MAIL_IN: 2, PICKUP: 1 });
  });

  it('requestsByStatus is zero-filled over every status', () => {
    expect(metrics.requestsByStatus).toEqual({ OPEN: 1, IN_TRANSIT: 0, RECEIVED: 0, COMPLETED: 2, REJECTED: 1, CANCELLED: 0, EXPIRED: 1, REVERSED: 1 });
  });

  it('completeHoursP50 is the nearest rank of hours to complete', () => {
    expect(metrics.completeHoursP50).toBe(30);
  });

  it('completeHoursP90 is the nearest rank of hours to complete', () => {
    expect(metrics.completeHoursP90).toBe(120);
  });

  it('unitsByItem sums received units per item, largest first', () => {
    expect(metrics.unitsByItem).toEqual([
      { itemId: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 22 },
      { itemId: 'HOP_SUA', itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', qty: 16 },
    ]);
  });

  it('unitsByPoint sums received units per point, largest first', () => {
    expect(metrics.unitsByPoint).toEqual([
      { pointId: 'P1', pointName: 'Tạp hoá Cô Ba', qty: 26 },
      { pointId: 'WH', pointName: 'Kho Tubu HCM', qty: 12 },
    ]);
  });

  it('pointsIssued sums the RECYCLE ledger rows of completed requests only, reversed ones included', () => {
    expect(metrics.pointsIssued).toBe(13000);
  });

  it('pointsReversed sums the points taken back by reversals', () => {
    expect(metrics.pointsReversed).toBe(2000);
  });

  it('receivedDeclaredPctByMethod is received over declared per method, one decimal', () => {
    expect(metrics.receivedDeclaredPctByMethod).toEqual({ DROP_OFF: 86.7, MAIL_IN: 100, PICKUP: 66.7 });
  });

  it('receivedDeclaredPctByPoint is received over declared per point', () => {
    expect(metrics.receivedDeclaredPctByPoint).toEqual([
      { pointId: 'P1', pct: 86.7 },
      { pointId: 'WH', pct: 85.7 },
    ]);
  });

  it('rejectionsByReason counts rejected requests of the created cohort by reason', () => {
    expect(metrics.rejectionsByReason.WET).toBe(1);
    const others = WASTE_REJECTION_REASON_VALUES.filter((r) => r !== 'WET');
    expect(others.map((r) => metrics.rejectionsByReason[r])).toEqual(others.map(() => 0));
  });

  it('expiredCount passes the expired cohort through', () => {
    expect(metrics.expiredCount).toBe(1);
  });

  it('quotaByPoint lists every partner point with its usage or zero', () => {
    expect(metrics.quotaByPoint).toEqual([
      { pointId: 'P1', pointName: 'Tạp hoá Cô Ba', quota: 100_000, used: 7000, confirmations: 1 },
      { pointId: 'P2', pointName: 'Cô Tư', quota: 300_000, used: 0, confirmations: 0 },
    ]);
  });

  it('pickupCount counts completed pickup requests', () => {
    expect(metrics.pickupCount).toBe(1);
  });

  it('carrierCostVnd sums the cost of completed pickup requests only', () => {
    expect(metrics.carrierCostVnd).toBe(22000);
  });

  it('receivedWeightGrams sums the weight of requests that have one', () => {
    expect(metrics.receivedWeightGrams).toBe(4500);
  });

  it('estimatedWeightGrams uses the same requests as the received weight', () => {
    expect(metrics.estimatedWeightGrams).toBe(4360);
  });

  it('repeatCustomers60d counts customers with an earlier completion within 60 days', () => {
    expect(metrics.repeatCustomers60d).toBe(1);
  });

  it('ordersOfExchangers passes the order count through', () => {
    expect(metrics.ordersOfExchangers).toBe(5);
  });

  it('ordersOfNonExchangers passes the order count through', () => {
    expect(metrics.ordersOfNonExchangers).toBe(12);
  });

  it('costVndPer1000PointsIssued is the carrier cost per 1000 points issued', () => {
    expect(metrics.costVndPer1000PointsIssued).toBe(1692);
  });
});

describe('buildWasteMonthMetrics edges and month range', () => {
  it('empty rows give null ratios, null weights and zero-filled enums', () => {
    const { metrics, perPoint } = buildWasteMonthMetrics({
      created: [],
      completed: [],
      issued: [],
      reversed: [],
      expiredCount: 0,
      partnerPoints: [],
      usage: [],
      completedLast60d: [],
      ordersOfExchangers: 0,
      ordersOfNonExchangers: 0,
    });
    expect(metrics.completeHoursP50).toBeNull();
    expect(metrics.completeHoursP90).toBeNull();
    expect(metrics.receivedDeclaredPctByMethod).toEqual({ DROP_OFF: null, MAIL_IN: null, PICKUP: null });
    expect(metrics.receivedWeightGrams).toBeNull();
    expect(metrics.estimatedWeightGrams).toBeNull();
    expect(metrics.costVndPer1000PointsIssued).toBeNull();
    expect(Object.values(metrics.requestsByStatus).every((n) => n === 0)).toBe(true);
    expect(Object.values(metrics.rejectionsByReason).every((n) => n === 0)).toBe(true);
    expect(Object.values(metrics.requestsCreatedByMethod).every((n) => n === 0)).toBe(true);
    expect(perPoint).toEqual([]);
  });

  it('perPoint is one row per point, sorted by point name', () => {
    expect(fixtureReport.perPoint).toEqual([
      { pointId: 'WH', pointName: 'Kho Tubu HCM', confirmations: 2, units: 12, pointsIssued: 6000, pointsReversed: 2000, quotaUsed: 0 },
      { pointId: 'P1', pointName: 'Tạp hoá Cô Ba', confirmations: 1, units: 26, pointsIssued: 7000, pointsReversed: 0, quotaUsed: 7000 },
    ]);
  });

  it('vnMonthRange starts at 00:00 of the first day in Vietnam time and ends at the next month start', () => {
    expect(vnMonthRange('2026-10')).toEqual({ start: new Date('2026-09-30T17:00:00.000Z'), end: new Date('2026-10-31T17:00:00.000Z') });
  });

  it('vnMonthRange rolls December into the next year', () => {
    expect(vnMonthRange('2026-12').end).toEqual(new Date('2026-12-31T17:00:00.000Z'));
  });

  it('vnMonthRange rejects a month that is not YYYY-MM', () => {
    expect(() => vnMonthRange('2026-13')).toThrow(new BadRequestException('Tháng phải có dạng YYYY-MM.'));
  });

  it('monthly filters every request query by point and applies the month convention', async () => {
    const { start, end } = vnMonthRange('2026-10');
    const range = { gte: start, lt: end };
    const wasteRequest = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    const prisma = {
      wasteRequest,
      wastePoint: { findMany: jest.fn().mockResolvedValue([]) },
      wastePointUsage: { findMany: jest.fn().mockResolvedValue([]) },
      pointsTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      order: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new WasteReportsService(prisma as never);

    await service.monthly('2026-10', 'P1');

    const wheres = [...wasteRequest.findMany.mock.calls, ...wasteRequest.count.mock.calls].map((c) => c[0].where as Record<string, unknown>);
    expect(wheres).toHaveLength(5);
    for (const w of wheres) expect(w.pointId).toBe('P1');
    expect(wheres).toContainEqual(expect.objectContaining({ createdAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ status: { in: ['COMPLETED', 'REVERSED'] }, completedAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ reversedAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ status: 'EXPIRED', closedAt: range }));
    expect(prisma.wastePointUsage.findMany).toHaveBeenCalledWith({ where: { monthKey: '2026-10', pointId: 'P1' } });
  });
});
