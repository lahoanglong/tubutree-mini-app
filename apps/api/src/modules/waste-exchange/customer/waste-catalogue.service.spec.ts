jest.mock('../../staff/attendance/zalo-location', () => ({ resolveZaloLocation: jest.fn() }));
import { resolveZaloLocation } from '../../staff/attendance/zalo-location';
import { WasteCatalogueService, haversineKm, isHiddenInactive } from './waste-catalogue.service';

const NOW = new Date('2026-10-17T03:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const pt = (o: Record<string, unknown>) => ({ kind: 'PARTNER', name: 'P', addressLine: 'a', provinceCode: '79', provinceName: 'TP.HCM', communeCode: 'c', communeName: 'C', lat: null, lng: null, phone: null, openingHours: {}, status: 'ACTIVE', monthlyQuotaPoints: 100_000, perkText: null, perkPendingText: 'chờ duyệt', sortOrder: 0, activatedAt: day(1), lastConfirmedAt: null, items: [], ...o });
function setup(points: unknown[], o: { enabled?: boolean; available?: string[]; usage?: { pointId: string; pointsUsed: number }[] } = {}) {
  const prisma = {
    wastePoint: { findMany: jest.fn().mockResolvedValue(points) },
    wasteItem: { findMany: jest.fn().mockResolvedValue([{ id: 'carton' }, { id: 'film' }]) },
    wastePointUsage: { findMany: jest.fn().mockResolvedValue(o.usage ?? []) },
  };
  const access = { availablePointIds: jest.fn(async (_d: unknown, ids: string[]) => new Set(o.available ?? ids)) };
  const config = { snapshot: jest.fn().mockResolvedValue({ pointInactiveDays: 60 }), isEnabled: jest.fn().mockResolvedValue(o.enabled ?? true) };
  const svc = new WasteCatalogueService(prisma as never, access as never, config as never);
  jest.useFakeTimers({ now: NOW });
  return { svc, prisma };
}
afterEach(() => jest.useRealTimers());

describe('isHiddenInactive (spec 5.5)', () => {
  it.each<[string, Record<string, unknown>, boolean]>([
    ['warehouse never', { kind: 'WAREHOUSE', lastConfirmedAt: day(400), activatedAt: day(400) }, false],
    ['later of the two dates counts', { kind: 'PARTNER', lastConfirmedAt: day(10), activatedAt: day(200) }, false],
    ['61 days idle', { kind: 'PARTNER', lastConfirmedAt: day(61), activatedAt: day(90) }, true],
    ['exactly 60 days is still visible', { kind: 'PARTNER', lastConfirmedAt: null, activatedAt: day(60) }, false],
    ['no dates at all is visible', { kind: 'PARTNER', lastConfirmedAt: null, activatedAt: null }, false],
  ])('%s', (_n, p, hidden) => expect(isHiddenInactive(p as never, NOW, 60)).toBe(hidden));
});

describe('WasteCatalogueService.listPoints', () => {
  it('available and not hidden, quotaFull derived, warehouse accepts every ACTIVE item, PARTNER only its links; pending perk never exposed', async () => {
    const { svc, prisma } = setup([
      pt({ id: 'wh', kind: 'WAREHOUSE', monthlyQuotaPoints: null, activatedAt: day(500) }),
      pt({ id: 'p1', items: [{ itemId: 'carton' }], perkText: 'Giảm 5% khi mua tại quầy' }),
      pt({ id: 'p2' }),
      pt({ id: 'idle', activatedAt: day(90) }),
      pt({ id: 'noOwner' }),
    ], { available: ['wh', 'p1', 'p2', 'idle'], usage: [{ pointId: 'p2', pointsUsed: 100_000 }] });
    const list = await svc.listPoints('79');
    expect(list.map((p) => [p.id, p.acceptedItemIds, p.quotaFull, p.distanceKm])).toEqual([
      ['wh', ['carton', 'film'], false, null], ['p1', ['carton'], false, null], ['p2', [], true, null],
    ]);
    expect(list[1]!.perkText).toBe('Giảm 5% khi mua tại quầy');
    expect(JSON.stringify(list)).not.toContain('perkPendingText');
    expect(Object.keys(list[1]!).sort()).toEqual(['acceptedItemIds', 'addressLine', 'communeCode', 'communeName', 'distanceKm', 'id', 'kind', 'lat', 'lng', 'name', 'openingHours', 'perkText', 'phone', 'provinceCode', 'provinceName', 'quotaFull']);
    expect(prisma.wastePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', provinceCode: '79' } }));
    expect(prisma.wastePointUsage.findMany).toHaveBeenCalledWith({ where: { pointId: { in: ['wh', 'p1', 'p2'] }, monthKey: '2026-10' }, select: { pointId: true, pointsUsed: true } });
  });
  it('a PARTNER never lists a warehouse-only item as accepted, even when a link to it exists; the warehouse still does', async () => {
    const { svc, prisma } = setup([
      pt({ id: 'wh', kind: 'WAREHOUSE', monthlyQuotaPoints: null, activatedAt: day(500) }),
      pt({ id: 'p1', items: [{ itemId: 'carton' }, { itemId: 'milk' }] }),
    ]);
    prisma.wasteItem.findMany.mockResolvedValue([
      { id: 'carton', warehouseOnly: false },
      { id: 'milk', warehouseOnly: true },
    ]);
    const list = await svc.listPoints();
    expect(list.map((p) => [p.id, p.acceptedItemIds])).toEqual([['wh', ['carton', 'milk']], ['p1', ['carton']]]);
  });
  it('returns at most 200 points', async () => {
    const { svc } = setup(Array.from({ length: 205 }, (_, i) => pt({ id: `p${i}` })));
    expect(await svc.listPoints()).toHaveLength(200);
  });
});

describe('WasteCatalogueService.nearbyPoints (spec 15.2, 14.4)', () => {
  const pts = [pt({ id: 'far', lat: 10.9, lng: 106.7 }), pt({ id: 'near', lat: 10.78, lng: 106.7 }), pt({ id: 'nolatlng' })];
  it('sorts by distance, points without coordinates last, distance rounded to 0.1 km', async () => {
    (resolveZaloLocation as jest.Mock).mockResolvedValue({ lat: 10.77, lng: 106.7 });
    const { svc } = setup(pts);
    const list = await svc.nearbyPoints({ locationToken: 'loc', zaloAccessToken: 'acc' });
    expect(list.map((p) => p.id)).toEqual(['near', 'far', 'nolatlng']);
    expect(list[0]!.distanceKm).toBe(1.1);
    expect(list[2]!.distanceKm).toBeNull();
  });
  it.each([['null location', () => Promise.resolve(null)], ['throws', () => Promise.reject(new Error('zalo down'))]])('%s -> same list without distances', async (_n, impl) => {
    (resolveZaloLocation as jest.Mock).mockImplementation(impl);
    const { svc } = setup(pts);
    expect((await svc.nearbyPoints({ locationToken: 'loc', zaloAccessToken: 'acc' })).map((p) => [p.id, p.distanceKm])).toEqual([['far', null], ['near', null], ['nolatlng', null]]);
  });
  it('haversineKm', () => expect(Math.round(haversineKm({ lat: 10.77, lng: 106.7 }, { lat: 10.78, lng: 106.7 }) * 1000)).toBe(1112));
});

describe('WasteCatalogueService.listItems', () => {
  it('ACTIVE and COMING_SOON only, by sortOrder then name; exactly the 16 DTO fields (spec 15.2)', async () => {
    const { svc, prisma } = setup([]);
    prisma.wasteItem.findMany.mockResolvedValueOnce([{
      id: 'carton', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300,
      dailyCapQty: 20, monthlyCapQty: 60, status: 'ACTIVE', prepInstructions: null, imageUrl: null, hazardous: false, sortOrder: 1, warehouseOnly: true,
      createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
    }]);
    const out = await svc.listItems();
    expect(prisma.wasteItem.findMany).toHaveBeenCalledWith({ where: { status: { in: ['ACTIVE', 'COMING_SOON'] } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    expect(Object.keys(out[0]!).sort()).toEqual(['code', 'dailyCapQty', 'dropsPerUnit', 'gramsPerUnit', 'hazardous', 'id', 'imageUrl', 'monthlyCapQty', 'name', 'pointsPerGroup', 'prepInstructions', 'sortOrder', 'status', 'unitLabel', 'unitsPerPoint', 'warehouseOnly']);
    expect(out[0]!.warehouseOnly).toBe(true);
  });
});

describe('WasteCatalogueService.publicItems', () => {
  it('chương trình đang bật thì trả danh mục món', async () => {
    const { svc, prisma } = setup([]);
    prisma.wasteItem.findMany.mockResolvedValueOnce([]);
    await expect(svc.publicItems()).resolves.toEqual([]);
    expect(prisma.wasteItem.findMany).toHaveBeenCalledTimes(1);
  });
  it('chương trình tắt thì không đọc cơ sở dữ liệu và trả rỗng', async () => {
    const { svc, prisma } = setup([], { enabled: false });
    await expect(svc.publicItems()).resolves.toEqual([]);
    expect(prisma.wasteItem.findMany).not.toHaveBeenCalled();
  });
});
