import { WasteMeService } from './waste-me.service';

const NOW = new Date('2026-10-17T03:00:00.000Z');
const SNAP = { enabled: true, mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 3, customerMonthlyCapPoints: 60_000, mailinMaxWeightKg: 20, mailinMaxEdgeCm: 50, rulesText: '' };
const ITEM = { id: 'carton', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, dailyCapQty: 20, monthlyCapQty: 60, status: 'ACTIVE', prepInstructions: null, imageUrl: null, gramsPerUnit: 300, hazardous: false, sortOrder: 1 };
const WH_DESK = [{ pointId: 'wh', name: 'Kho Tubu', kind: 'WAREHOUSE' }];
function setup(user: unknown, o: { snap?: Partial<typeof SNAP>; completed?: unknown[]; desk?: unknown[] } = {}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    wasteItem: { findMany: jest.fn().mockResolvedValue([ITEM]) },
    wasteRequest: { findMany: jest.fn().mockImplementation(({ where }: { where: { status: unknown } }) => Promise.resolve(where.status === 'COMPLETED' ? (o.completed ?? []) : [])) },
  };
  const deps = {
    config: { snapshot: jest.fn().mockResolvedValue({ ...SNAP, ...o.snap }) },
    systemConfig: { get: jest.fn(async (k: string, d: unknown) => ({ 'waste.enabled': true, 'waste.lane_dropoff_enabled': true, 'waste.lane_mailin_enabled': true, 'waste.lane_pickup_enabled': false } as Record<string, unknown>)[k] ?? d) },
    access: { listOperablePoints: jest.fn().mockResolvedValue(o.desk ?? WH_DESK) },
    hold: { capUsage: jest.fn().mockResolvedValue({ itemDay: new Map([['carton', 5]]), itemMonth: new Map([['carton', 12]]), pointsMonth: 12_000, openCount: 1, pickupPendingCode: null }) },
    loyalty: { lockedOrderPoints: jest.fn().mockResolvedValue({ locked: 30_000 }) },
  };
  const svc = new WasteMeService(prisma as never, deps.config as never, deps.systemConfig as never, deps.access as never, deps.hold as never, deps.loyalty as never);
  jest.useFakeTimers({ now: NOW });
  return { svc, prisma, ...deps };
}
afterEach(() => jest.useRealTimers());
const base = { id: 'u1', phone: '0901234567', zaloId: 'z1', role: 'STAFF', isBlocked: false, mergedIntoId: null, pointsBalance: 100_000, pointsConvertedBalance: 20_000, wasteFlags: { blockedAt: null, shipLockedAt: new Date('2026-10-10T00:00:00Z') } };

describe('WasteMeService.me (spec 15.1 read exception, 15.2 row)', () => {
  it('eligible: balance with redeemablePoints, month usage, remaining caps, open requests, desk points, ship lock', async () => {
    const { svc, hold } = setup(base);
    const me = await svc.me('u1');
    expect(me).toMatchObject({
      programmeEnabled: true, eligibility: 'OK', blocked: false, shipLockedAt: '2026-10-10T00:00:00.000Z',
      laneFlags: { dropoff: true, mailin: true, pickup: false }, parcelLimits: { maxWeightKg: 20, maxEdgeCm: 50 },
      balance: { pointsBalance: 100_000, pointsConvertedBalance: 20_000, redeemablePoints: 70_000 },
      monthUsage: { capMonthKey: '2026-10', pointsUsed: 12_000, pointsCap: 60_000 },
      thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 3 },
      openRequests: [], deskPoints: [{ id: 'wh', name: 'Kho Tubu', kind: 'WAREHOUSE' }], impactGrams: null,
    });
    expect(me.items[0]).toMatchObject({ id: 'carton', monthRemainingQty: 48, dayRemainingQty: 15 });
    expect(hold.capUsage).toHaveBeenCalledWith(expect.anything(), 'u1', '2026-10-17', '2026-10');
  });
  it.each<[string, unknown, string]>([
    ['guest customer', { ...base, role: 'CUSTOMER', phone: null, zaloId: 'guest_d1', wasteFlags: null }, 'GUEST'],
    ['customer without phone', { ...base, role: 'CUSTOMER', phone: null, wasteFlags: null }, 'NEED_PHONE'],
    ['missing user row', null, 'GUEST'],
  ])('%s: 200 with items and lane flags, no requests, no balance; desk points only from staff rows', async (_n, user, eligibility) => {
    const { svc, access, hold } = setup(user, { desk: [] });
    const me = await svc.me('u1');
    expect(me).toMatchObject({ eligibility, balance: null, monthUsage: null, impactGrams: null, openRequests: [], deskPoints: [], laneFlags: { dropoff: true, mailin: true, pickup: false } });
    expect(me.items[0]).toMatchObject({ monthRemainingQty: 60, dayRemainingQty: 20 });
    expect(access.listOperablePoints).toHaveBeenCalledTimes(user ? 1 : 0);
    expect(hold.capUsage).not.toHaveBeenCalled();
  });
  it('STAFF without a phone: NEED_PHONE, desk points still list the warehouse, customer fields omitted (registry 8.33)', async () => {
    const { svc, access, hold, prisma } = setup({ ...base, phone: null, wasteFlags: null });
    const me = await svc.me('u1');
    expect(me).toMatchObject({ eligibility: 'NEED_PHONE', deskPoints: [{ id: 'wh', name: 'Kho Tubu', kind: 'WAREHOUSE' }], balance: null, monthUsage: null, impactGrams: null, openRequests: [] });
    expect(access.listOperablePoints).toHaveBeenCalledWith('u1', true);
    expect(hold.capUsage).not.toHaveBeenCalled();
    expect(prisma.wasteRequest.findMany).not.toHaveBeenCalled();
  });
  it('programme off and blockedAt still return own data (read exception)', async () => {
    const { svc } = setup({ ...base, wasteFlags: { blockedAt: new Date('2026-10-01T00:00:00Z'), shipLockedAt: null } }, { snap: { enabled: false } });
    await expect(svc.me('u1')).resolves.toMatchObject({ programmeEnabled: false, blocked: true, eligibility: 'OK', balance: { redeemablePoints: 70_000 } });
  });
  it('impactGrams sums received x grams over COMPLETED requests whose every line is weighed (spec 5.7)', async () => {
    const completed = [
      { lines: [{ receivedQty: 8, gramsPerUnit: 300 }, { receivedQty: 2, gramsPerUnit: 50 }] },
      { lines: [{ receivedQty: 5, gramsPerUnit: 300 }, { receivedQty: 9, gramsPerUnit: null }] },
    ];
    const { svc } = setup(base, { completed });
    expect((await svc.me('u1')).impactGrams).toBe(2500);
  });
});

describe('WasteMeService.rules', () => {
  it('empty text -> null, else the text', async () => {
    await expect(setup(base).svc.rules()).resolves.toEqual({ text: null });
    await expect(setup(base, { snap: { rulesText: 'Thể lệ chương trình' } }).svc.rules()).resolves.toEqual({ text: 'Thể lệ chương trình' });
  });
});
