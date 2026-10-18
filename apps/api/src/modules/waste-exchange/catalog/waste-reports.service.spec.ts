import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WASTE_REJECTION_REASON_VALUES } from '@tubutree/shared-types';
import { computeWasteAlerts } from './waste-alerts';
import {
  buildWasteMonthMetrics,
  flattenWasteMetrics,
  vnMonthRange,
  WasteReportsService,
  type WasteMonthlyReport,
  type WasteMonthRows,
} from './waste-reports.service';

jest.mock('./waste-alerts');

const DEFAULT_THRESHOLDS = {
  quotaPacePct: 60, quotaPaceDays: 10, fullMatchPct: 95, fullMatchMinSample: 10, repeatCustomerCount: 3, repeatCustomerDays: 7,
  avgUnitsFactor: 2, lookupMissCount: 10, lookupMissDays: 1, staffDirectCount: 5, staffDirectDays: 7,
};

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
      order: { count: jest.fn(({ where }: { where: { userId: object } }) => Promise.resolve('in' in where.userId ? 3 : 7)) },
    };
    const config = { snapshot: jest.fn() };
    const access = { assertPointAccess: jest.fn() };
    const service = new WasteReportsService(prisma as never, access as never, config as never);

    const res = await service.monthly('2026-10', 'P1');

    const wheres = [...wasteRequest.findMany.mock.calls, ...wasteRequest.count.mock.calls].map((c) => c[0].where as Record<string, unknown>);
    expect(wheres).toHaveLength(5);
    for (const w of wheres) expect(w.pointId).toBe('P1');
    expect(wheres).toContainEqual(expect.objectContaining({ createdAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ status: { in: ['COMPLETED', 'REVERSED'] }, completedAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ reversedAt: range }));
    expect(wheres).toContainEqual(expect.objectContaining({ status: 'EXPIRED', closedAt: range }));
    expect(prisma.wastePointUsage.findMany).toHaveBeenCalledWith({ where: { monthKey: '2026-10', pointId: 'P1' } });
    const lookback = { gte: new Date(start.getTime() - 60 * 24 * 3_600_000), lt: end };
    expect(wheres).toContainEqual(expect.objectContaining({ status: { in: ['COMPLETED', 'REVERSED'] }, completedAt: lookback }));
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { createdAt: range, status: { not: 'CANCELLED' }, userId: { in: [] } } });
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { createdAt: range, status: { not: 'CANCELLED' }, userId: { notIn: [] } } });
    expect(res.metrics).toMatchObject({ ordersOfExchangers: 3, ordersOfNonExchangers: 7 });
  });
});

describe('WasteReportsService overview, csv and point reports', () => {
  const config = { snapshot: jest.fn() };
  const access = { assertPointAccess: jest.fn() };
  const prisma = { wastePoint: { findUnique: jest.fn() } };
  const build = () => new WasteReportsService(prisma as never, access as never, config as never);
  const pointReport: WasteMonthlyReport = {
    month: '2026-10',
    pointId: 'P1',
    metrics: { ...fixtureReport.metrics, pointsIssued: 7000, pointsReversed: 0 },
    perPoint: [],
    confirmations: 1,
    quotaUsed: 7000,
  };
  const withPoints = (names: string[]): WasteMonthlyReport => ({
    ...fixtureReport,
    perPoint: names.map((pointName) => ({ pointId: pointName, pointName, confirmations: 1, units: 1, pointsIssued: 1, pointsReversed: 0, quotaUsed: 0 })),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    config.snapshot.mockResolvedValue({ enabled: true, alertThresholds: DEFAULT_THRESHOLDS });
    access.assertPointAccess.mockResolvedValue(undefined);
  });

  it('overview reads this month and the previous one and attaches the computed alerts', async () => {
    const svc = build();
    const current = { ...fixtureReport, month: '2026-10' };
    const previous = { ...fixtureReport, month: '2026-09' };
    const monthly = jest.spyOn(svc, 'monthly').mockImplementation(async (m: string) => (m === '2026-10' ? current : previous));
    const alerts = [{ kind: 'STAFF_ACCOUNT_CONFIRMED', value: 1, threshold: null, detail: 'x' }];
    (computeWasteAlerts as jest.Mock).mockResolvedValue(alerts);

    const result = await svc.overview('2026-10');

    expect(monthly).toHaveBeenCalledWith('2026-10');
    expect(monthly).toHaveBeenCalledWith('2026-09');
    expect(result).toEqual({ month: '2026-10', previousMonth: '2026-09', current: current.metrics, previous: previous.metrics, alerts });
    expect(computeWasteAlerts).toHaveBeenCalledWith(prisma, expect.any(Date), DEFAULT_THRESHOLDS);
  });

  it('overview rolls January back into December of the previous year', async () => {
    const svc = build();
    jest.spyOn(svc, 'monthly').mockResolvedValue(fixtureReport);
    (computeWasteAlerts as jest.Mock).mockResolvedValue([]);

    expect((await svc.overview('2026-01')).previousMonth).toBe('2025-12');
  });

  it('csv writes the byte-order mark, one row per point, the total and the metric rows', async () => {
    const svc = build();
    jest.spyOn(svc, 'monthly').mockResolvedValue(fixtureReport);

    const text = await svc.csv('2026-10');

    expect(
      text.startsWith(
        '\uFEFFĐiểm nhận,Số lượt,Số đơn vị,Đã cộng,Đã thu hồi,Hạn mức đã dùng\r\nKho Tubu HCM,2,12,6000,2000,0\r\nTạp hoá Cô Ba,1,26,7000,0,7000\r\nTổng,3,38,13000,2000,7000\r\n\r\nChỉ số,Giá trị\r\n',
      ),
    ).toBe(true);
  });

  it('csv labels received-versus-declared per point with the point name, and the id only when the point has no units row', async () => {
    const svc = build();
    jest.spyOn(svc, 'monthly').mockResolvedValue({
      ...fixtureReport,
      metrics: {
        ...fixtureReport.metrics,
        receivedDeclaredPctByPoint: [...fixtureReport.metrics.receivedDeclaredPctByPoint, { pointId: 'GONE', pct: 50 }],
      },
    });

    const text = await svc.csv('2026-10');

    expect(text).toContain('\r\nreceivedDeclaredPctByPoint.Tạp hoá Cô Ba,86.7\r\n');
    expect(text).toContain('\r\nreceivedDeclaredPctByPoint.Kho Tubu HCM,85.7\r\n');
    expect(text).toContain('\r\nreceivedDeclaredPctByPoint.GONE,50\r\n');
    expect(text).not.toContain('receivedDeclaredPctByPoint.P1');
    expect(text).not.toContain('receivedDeclaredPctByPoint.WH');
  });

  it('csv quotes a point name with a comma and neutralises a leading equals sign', async () => {
    const svc = build();
    jest.spyOn(svc, 'monthly').mockResolvedValue(withPoints(['Cô Ba, Q.1', '=HYPERLINK("x")']));

    const text = await svc.csv('2026-10');

    expect(text).toContain('\r\n"Cô Ba, Q.1",1,1,1,0,0\r\n');
    expect(text).toContain('\r\n"\'=HYPERLINK(""x"")",1,1,1,0,0\r\n');
  });

  it('csv rejects a month that is not YYYY-MM', async () => {
    await expect(build().csv('2026-13')).rejects.toThrow(new BadRequestException('Tháng phải có dạng YYYY-MM.'));
  });

  it('pointReport checks point access before reading and maps to the aggregate-only DTO', async () => {
    const svc = build();
    const monthly = jest.spyOn(svc, 'monthly').mockResolvedValue(pointReport);

    const result = await svc.pointReport('o1', 'P1', '2026-10');

    expect(access.assertPointAccess).toHaveBeenCalledWith('o1', 'P1', { programmeEnabled: true });
    expect(access.assertPointAccess.mock.invocationCallOrder[0]).toBeLessThan(monthly.mock.invocationCallOrder[0]!);
    expect(monthly).toHaveBeenCalledWith('2026-10', 'P1');
    expect(result).toEqual({ pointId: 'P1', month: '2026-10', confirmations: 1, pointsAwarded: 7000, quotaUsed: 7000, units: pointReport.metrics.unitsByItem });
    expect(Object.keys(result)).toEqual(['pointId', 'month', 'confirmations', 'pointsAwarded', 'quotaUsed', 'units']);
  });

  it('pointReport passes the access refusal through and reads nothing', async () => {
    const svc = build();
    const monthly = jest.spyOn(svc, 'monthly');
    access.assertPointAccess.mockRejectedValue(new ForbiddenException('no'));

    await expect(svc.pointReport('o1', 'P1', '2026-10')).rejects.toBeInstanceOf(ForbiddenException);
    expect(monthly).not.toHaveBeenCalled();
  });

  it('adminPointReport answers 404 for a missing point', async () => {
    const svc = build();
    prisma.wastePoint.findUnique.mockResolvedValue(null);

    await expect(svc.adminPointReport('NOPE', '2026-10')).rejects.toThrow(new NotFoundException('Không tìm thấy điểm nhận.'));
  });

  it('adminPointReport maps like pointReport without a point access check', async () => {
    const svc = build();
    prisma.wastePoint.findUnique.mockResolvedValue({ id: 'P1' });
    jest.spyOn(svc, 'monthly').mockResolvedValue(pointReport);

    const result = await svc.adminPointReport('P1', '2026-10');

    expect(prisma.wastePoint.findUnique).toHaveBeenCalledWith({ where: { id: 'P1' }, select: { id: true } });
    expect(result).toEqual({ pointId: 'P1', month: '2026-10', confirmations: 1, pointsAwarded: 7000, quotaUsed: 7000, units: pointReport.metrics.unitsByItem });
    expect(access.assertPointAccess).not.toHaveBeenCalled();
  });

  it('flattenWasteMetrics covers every metric key and writes null as an empty cell', () => {
    const m = fixtureReport.metrics;
    const labels = flattenWasteMetrics(m).map(([label]) => label);

    for (const k of Object.keys(m)) expect(labels.some((l) => l === k || l.startsWith(`${k}.`))).toBe(true);
    expect(flattenWasteMetrics({ ...m, completeHoursP50: null })).toContainEqual(['completeHoursP50', '']);
  });
});
