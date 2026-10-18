import { computeWasteAlerts } from './waste-alerts';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { WasteAlertDTO, WasteAlertKind, WasteAlertThresholds } from '@tubutree/shared-types';

const T: WasteAlertThresholds = {
  quotaPacePct: 60,
  quotaPaceDays: 10,
  fullMatchPct: 95,
  fullMatchMinSample: 10,
  repeatCustomerCount: 3,
  repeatCustomerDays: 7,
  avgUnitsFactor: 2,
  lookupMissCount: 10,
  lookupMissDays: 1,
  staffDirectCount: 5,
  staffDirectDays: 7,
};

const NOW = new Date('2026-10-08T03:00:00Z');

type VisitOpts = {
  id: string; code: string; userId: string; pointId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; completedAt: Date;
  inTransitAt: Date | null; confirmedByUserId: string; pointsAwarded: number; role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
  lines: { declaredQty: number; receivedQty: number | null }[];
};
const visit = ({ role = 'CUSTOMER', ...o }: Partial<VisitOpts> = {}) => ({
  id: 'r1', code: 'TR-ABCDE', userId: 'U1', pointId: 'P1', method: 'DROP_OFF' as VisitOpts['method'],
  completedAt: new Date('2026-10-03T03:00:00Z'), inTransitAt: null as Date | null, confirmedByUserId: 'S1', pointsAwarded: 1000,
  lines: [{ declaredQty: 1, receivedQty: 1 }] as VisitOpts['lines'], ...o, user: { role },
});

const POINTS = [
  { id: 'P1', name: 'Tạp hoá Cô Ba', kind: 'PARTNER', monthlyQuotaPoints: 100000 },
  { id: 'P2', name: 'Cửa hàng Chú Tư', kind: 'PARTNER', monthlyQuotaPoints: null },
  { id: 'W1', name: 'Kho Tubu', kind: 'WAREHOUSE', monthlyQuotaPoints: null },
];
const USERS = [
  { id: 'S1', fullName: 'Lê Văn Kho' },
  { id: 'S2', fullName: 'Trần Thị Điểm' },
  { id: 'S3', fullName: null },
];

function setup(rows: ReturnType<typeof visit>[] = [], opts: { misses?: unknown[]; points?: unknown[]; users?: unknown[] } = {}) {
  const db = {
    wastePoint: { findMany: jest.fn().mockResolvedValue(opts.points ?? POINTS) },
    wasteRequest: { findMany: jest.fn().mockResolvedValue(rows) },
    wasteEvent: { groupBy: jest.fn().mockResolvedValue(opts.misses ?? []) },
    user: { findMany: jest.fn().mockResolvedValue(opts.users ?? USERS) },
  };
  return { db, run: (now = NOW) => computeWasteAlerts(db as unknown as PrismaService, now, T) };
}

const ofKind = (alerts: WasteAlertDTO[], kind: WasteAlertKind) => alerts.filter((a) => a.kind === kind);
const manyVisits = (n: number, o: Partial<VisitOpts> = {}, fullFrom = n) =>
  Array.from({ length: n }, (_, i) =>
    visit({ id: `r${i}`, userId: `U${i}`, lines: [{ declaredQty: 2, receivedQty: i < fullFrom ? 2 : 1 }], ...o }),
  );

describe('computeWasteAlerts', () => {
  it('QUOTA_PACE: flags a partner point above 60% of its quota in the first 10 days', async () => {
    const { run } = setup([
      visit({ id: 'a', pointsAwarded: 40000 }),
      visit({ id: 'b', pointsAwarded: 21000, completedAt: new Date('2026-10-05T03:00:00Z') }),
    ]);
    const alerts = ofKind(await run(), 'QUOTA_PACE');
    expect(alerts).toEqual([
      {
        kind: 'QUOTA_PACE', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', value: 61, threshold: 60,
        detail: 'Đã dùng 61% hạn mức tháng trong 10 ngày đầu tháng.',
      },
    ]);
  });

  it('QUOTA_PACE boundary: exactly 60% gives no alert and a visit after day 10 does not count', async () => {
    const exact = setup([visit({ pointsAwarded: 60000 })]);
    expect(ofKind(await exact.run(), 'QUOTA_PACE')).toEqual([]);

    const late = setup([
      visit({ id: 'a', pointsAwarded: 60000 }),
      visit({ id: 'b', pointsAwarded: 50000, completedAt: new Date('2026-10-11T03:00:00Z') }),
    ]);
    expect(ofKind(await late.run(new Date('2026-10-20T03:00:00Z')), 'QUOTA_PACE')).toEqual([]);
  });

  it('FULL_MATCH: needs the minimum sample', async () => {
    const ten = setup(manyVisits(10));
    expect(ofKind(await ten.run(), 'FULL_MATCH')).toEqual([
      {
        kind: 'FULL_MATCH', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', value: 100, threshold: 95,
        detail: '100% lượt nhận đủ đúng số khai (10 lượt trong tháng).',
      },
    ]);
    const nine = setup(manyVisits(9));
    expect(ofKind(await nine.run(), 'FULL_MATCH')).toEqual([]);
  });

  it('FULL_MATCH: 90% gives no alert, 95% does', async () => {
    const ninety = setup(manyVisits(20, {}, 18));
    expect(ofKind(await ninety.run(), 'FULL_MATCH')).toEqual([]);
    const ninetyFive = setup(manyVisits(20, {}, 19));
    const alerts = ofKind(await ninetyFive.run(), 'FULL_MATCH');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.value).toBe(95);
  });

  it('FULL_MATCH_CONFIRMER: one alert for the confirmer across two points, no point on it', async () => {
    const rows = [
      ...manyVisits(5, { pointId: 'P1' }).map((v, i) => ({ ...v, id: `a${i}` })),
      ...manyVisits(5, { pointId: 'P2' }).map((v, i) => ({ ...v, id: `b${i}` })),
    ];
    const { run } = setup(rows);
    const alerts = ofKind(await run(), 'FULL_MATCH_CONFIRMER');
    expect(alerts).toEqual([
      {
        kind: 'FULL_MATCH_CONFIRMER', confirmerName: 'Lê Văn Kho', value: 100, threshold: 95,
        detail: '100% lượt nhận đủ đúng số khai (10 lượt trong tháng).',
      },
    ]);
    expect(alerts[0]).not.toHaveProperty('pointId');
    expect(ofKind(await run(), 'FULL_MATCH')).toEqual([]);
  });

  const unitRows = () => [
    ...[0, 1].map((i) =>
      visit({ id: `a${i}`, pointId: 'P1', confirmedByUserId: 'S1', lines: [{ declaredQty: 30, receivedQty: 20 }, { declaredQty: 10, receivedQty: 10 }] }),
    ),
    ...[0, 1, 2, 3].map((i) =>
      visit({ id: `b${i}`, pointId: 'P2', confirmedByUserId: 'S2', lines: [{ declaredQty: 10, receivedQty: 10 }] }),
    ),
  ];

  it('AVG_UNITS: flags a point above twice the average of the others', async () => {
    const { run } = setup(unitRows());
    const alerts = ofKind(await run(), 'AVG_UNITS');
    expect(alerts).toEqual([
      {
        kind: 'AVG_UNITS', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', value: 30, threshold: 20,
        detail: 'Trung bình 30 đơn vị mỗi lượt, cao hơn 2 lần mức của các điểm khác.',
      },
    ]);
  });

  it('AVG_UNITS: no alert when only one point has visits', async () => {
    const { run } = setup([visit({ id: 'a', lines: [{ declaredQty: 99, receivedQty: 99 }] }), visit({ id: 'b', lines: [{ declaredQty: 99, receivedQty: 99 }] })]);
    const alerts = await run();
    expect(ofKind(alerts, 'AVG_UNITS')).toEqual([]);
    expect(ofKind(alerts, 'AVG_UNITS_CONFIRMER')).toEqual([]);
  });

  it('AVG_UNITS_CONFIRMER: same numbers by confirmer', async () => {
    const { run } = setup(unitRows());
    const alerts = ofKind(await run(), 'AVG_UNITS_CONFIRMER');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ confirmerName: 'Lê Văn Kho', value: 30, threshold: 20 });
    expect(alerts[0]?.detail.endsWith('những người xác nhận khác.')).toBe(true);
  });

  it('REPEAT_CUSTOMER: three visits of one customer at one point in 7 days, without any customer identity', async () => {
    const rows = [0, 1, 2].map((i) =>
      visit({ id: `r${i}`, userId: 'U1', completedAt: new Date(`2026-10-0${i + 2}T03:00:00Z`) }),
    );
    const { run } = setup(rows);
    const alerts = ofKind(await run(), 'REPEAT_CUSTOMER');
    expect(alerts).toEqual([
      {
        kind: 'REPEAT_CUSTOMER', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', value: 3, threshold: 3,
        detail: 'Một khách có 3 lượt ở điểm này trong 7 ngày.',
      },
    ]);
    expect(JSON.stringify(alerts)).not.toContain('U1');

    const old = setup(
      [0, 1, 2].map((i) => visit({ id: `o${i}`, userId: 'U1', completedAt: new Date('2026-09-30T20:00:00Z') })),
    );
    expect(ofKind(await old.run(), 'REPEAT_CUSTOMER')).toEqual([]);
  });

  it('LOOKUP_MISS: flags a point at 10 misses in a day and asks for the last day only', async () => {
    const { db, run } = setup([], {
      misses: [
        { pointId: 'P1', _count: { _all: 10 } },
        { pointId: 'P2', _count: { _all: 9 } },
      ],
    });
    const alerts = await run();
    expect(ofKind(alerts, 'LOOKUP_MISS')).toEqual([
      {
        kind: 'LOOKUP_MISS', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', value: 10, threshold: 10,
        detail: '10 lần tra mã không ra kết quả trong 1 ngày.',
      },
    ]);
    const arg = db.wasteEvent.groupBy.mock.calls[0][0] as { where: { createdAt: { gte: Date } } };
    expect(arg.where.createdAt.gte).toEqual(new Date('2026-10-07T03:00:00Z'));
  });

  it('STAFF_ACCOUNT_CONFIRMED: every staff account request confirmed by another person, no threshold', async () => {
    const { run } = setup([
      visit({ id: 'a', userId: 'S2', role: 'STAFF', confirmedByUserId: 'S1' }),
      visit({ id: 'b', code: 'TR-SELF1', userId: 'S2', role: 'STAFF', confirmedByUserId: 'S2' }),
      visit({ id: 'c', code: 'TR-CUST1', userId: 'U1', role: 'CUSTOMER', confirmedByUserId: 'S1' }),
    ]);
    expect(ofKind(await run(), 'STAFF_ACCOUNT_CONFIRMED')).toEqual([
      {
        kind: 'STAFF_ACCOUNT_CONFIRMED', pointId: 'P1', pointName: 'Tạp hoá Cô Ba', confirmerName: 'Lê Văn Kho', value: 1, threshold: null,
        detail: 'Yêu cầu TR-ABCDE của tài khoản nhân viên do người khác xác nhận.',
      },
    ]);

    const admin = setup([visit({ id: 'd', code: 'TR-ADMIN', userId: 'S3', role: 'ADMIN', confirmedByUserId: 'S1' })]);
    expect(ofKind(await admin.run(), 'STAFF_ACCOUNT_CONFIRMED')).toEqual([
      expect.objectContaining({ value: 1, threshold: null, detail: 'Yêu cầu TR-ADMIN của tài khoản nhân viên do người khác xác nhận.' }),
    ]);
  });

  it('STAFF_DIRECT: five direct confirms of mail-in or pickup requests without a waybill', async () => {
    const direct = (i: number, o: Partial<VisitOpts> = {}) =>
      visit({ id: `d${i}`, userId: `U${i}`, method: i % 2 ? 'MAIL_IN' : 'PICKUP', ...o });
    const rows = [
      ...[0, 1, 2, 3, 4].map((i) => direct(i)),
      direct(5, { inTransitAt: new Date('2026-10-04T03:00:00Z') }),
      visit({ id: 'x1', userId: 'U9', method: 'DROP_OFF' }),
      visit({ id: 'x2', userId: 'U8', method: 'DROP_OFF' }),
    ];
    const { run } = setup(rows);
    expect(ofKind(await run(), 'STAFF_DIRECT')).toEqual([
      {
        kind: 'STAFF_DIRECT', confirmerName: 'Lê Văn Kho', value: 5, threshold: 5,
        detail: '5 yêu cầu gửi kho hoặc thu kèm được xác nhận thẳng, chưa từng có mã vận đơn, trong 7 ngày.',
      },
    ]);

    const four = setup(rows.slice(1));
    expect(ofKind(await four.run(), 'STAFF_DIRECT')).toEqual([]);

    const early = setup([0, 1, 2, 3, 4].map((i) => direct(i, { completedAt: new Date('2026-09-28T03:00:00Z') })));
    expect(ofKind(await early.run(new Date('2026-10-03T03:00:00Z')), 'STAFF_DIRECT')).toHaveLength(1);
    const stale = setup([0, 1, 2, 3, 4].map((i) => direct(i, { completedAt: new Date('2026-09-30T03:00:00Z') })));
    expect(ofKind(await stale.run(new Date('2026-10-08T03:00:00Z')), 'STAFF_DIRECT')).toEqual([]);
  });

  it('passes the earlier of the month start and the longest window as since', async () => {
    const day20 = setup();
    await day20.run(new Date('2026-10-20T03:00:00Z'));
    const a = day20.db.wasteRequest.findMany.mock.calls[0][0] as { where: { completedAt: { gte: Date } } };
    expect(a.where.completedAt.gte).toEqual(new Date('2026-09-30T17:00:00Z'));

    const day3 = setup();
    const now3 = new Date('2026-10-03T03:00:00Z');
    await day3.run(now3);
    const b = day3.db.wasteRequest.findMany.mock.calls[0][0] as { where: { completedAt: { gte: Date } } };
    expect(b.where.completedAt.gte).toEqual(new Date('2026-09-26T03:00:00Z'));
  });

  it('returns [] with no data and orders by kind, then value descending', async () => {
    const empty = setup();
    expect(await empty.run()).toEqual([]);
    expect(empty.db.user.findMany).not.toHaveBeenCalled();

    const { run } = setup([], {
      misses: [
        { pointId: 'P2', _count: { _all: 12 } },
        { pointId: 'P1', _count: { _all: 15 } },
      ],
    });
    const alerts = await run();
    expect(alerts.map((a) => [a.kind, a.pointId, a.value])).toEqual([
      ['LOOKUP_MISS', 'P1', 15],
      ['LOOKUP_MISS', 'P2', 12],
    ]);

    const rows = [
      ...manyVisits(10),
      visit({ id: 'sa', code: 'TR-STAFF', userId: 'S2', role: 'STAFF', confirmedByUserId: 'S1', pointId: 'P2' }),
    ];
    const mixed = setup(rows, { misses: [{ pointId: 'P1', _count: { _all: 10 } }] });
    const kinds = (await mixed.run()).map((a) => a.kind);
    expect(kinds).toEqual([...kinds].sort((x, y) => order(x) - order(y)));
    expect(kinds).toEqual(expect.arrayContaining(['FULL_MATCH', 'LOOKUP_MISS', 'STAFF_ACCOUNT_CONFIRMED']));
  });
});

function order(kind: WasteAlertKind): number {
  return [
    'QUOTA_PACE', 'FULL_MATCH', 'FULL_MATCH_CONFIRMER', 'AVG_UNITS', 'AVG_UNITS_CONFIRMER', 'REPEAT_CUSTOMER', 'LOOKUP_MISS',
    'STAFF_ACCOUNT_CONFIRMED', 'STAFF_DIRECT',
  ].indexOf(kind);
}
