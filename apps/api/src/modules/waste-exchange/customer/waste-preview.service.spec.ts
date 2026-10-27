import { computeWastePublicFlags } from '../core/waste-public-config';
import { CUSTOMER_VISIBLE_ITEMS_WHERE } from './waste-catalogue.service';
import { WastePreviewService } from './waste-preview.service';

jest.mock('../core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ enabled: true, dropoff: true, mailin: true, pickup: true }) }));

const NOW = new Date('2026-10-17T03:00:00.000Z');
const table = { zones: [{ name: 'Nội thành HCM', provinceCodes: ['79'], low: 20000, high: 35000 }], defaultZone: { name: 'Toàn quốc', low: 30000, high: 85000 } };
const snap = { laneDropoff: true, laneMailin: true, lanePickup: false, mailinMinPoints: 15_000, pickupMinPoints: 10_000, customerMonthlyCapPoints: 60_000, maxOpenRequests: 3, requestHoldDays: 7, mailinFeeTable: table };
const line = { itemId: 'carton', itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300, declaredQty: 12, hazardous: false };
function setup(o: { blocks?: unknown[]; address?: unknown; codeAddress?: unknown; pointProvince?: unknown; snap?: Partial<typeof snap> } = {}) {
  const evaluate = jest.fn().mockResolvedValue({ result: { pointId: 'wh', capDayKey: '2026-10-17', capMonthKey: '2026-10', lines: [line], estimatedPoints: 12_000, estimatedDrops: 24 }, blocks: o.blocks ?? [] });
  const hold = { evaluate, capUsage: jest.fn().mockResolvedValue({ itemDay: new Map([['carton', 5]]), itemMonth: new Map([['carton', 40]]), pointsMonth: 50_000, openCount: 0, pickupPendingCode: null }) };
  const prisma = {
    wasteItem: { findMany: jest.fn().mockResolvedValue([{ id: 'carton', dailyCapQty: 20, monthlyCapQty: 60 }]) },
    address: { findFirst: jest.fn(async ({ where }: { where: { provinceCode?: string } }) => (where.provinceCode ? (o.codeAddress ?? null) : (o.address ?? null))) },
    wastePoint: { findFirst: jest.fn().mockResolvedValue(o.pointProvince ?? null) },
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ ...snap, ...o.snap }) };
  const systemConfig = { get: jest.fn(async (k: string, d: unknown) => (k === 'loyalty.vnd_per_point_redeem' ? 1 : d)) };
  jest.useFakeTimers({ now: NOW });
  return { svc: new WastePreviewService(prisma as never, config as never, systemConfig as never, hold as never), hold, prisma };
}
beforeEach(() => jest.mocked(computeWastePublicFlags).mockClear());
afterEach(() => jest.useRealTimers());
const body = { lines: [{ itemId: 'carton', declaredQty: 12 }] };

describe('WastePreviewService.preview (spec 15.2)', () => {
  it('no method: DROP_OFF evaluation, only month item cap and points cap blocks kept; no fee', async () => {
    const { svc, hold } = setup({ blocks: [{ code: 'LANE_DISABLED' }, { code: 'ITEM_DAY_CAP', itemId: 'carton' }, { code: 'ITEM_MONTH_CAP', itemId: 'carton' }, { code: 'POINTS_MONTH_CAP', pointsRemaining: 10_000 }, { code: 'POINT_UNAVAILABLE' }] });
    const r = await svc.preview('u1', body);
    expect(hold.evaluate).toHaveBeenCalledWith(expect.anything(), { path: 'CREATE', userId: 'u1', method: 'DROP_OFF', lines: body.lines, pointId: null, now: NOW }, expect.objectContaining({ laneDropoff: true, maxOpenRequests: 3 }));
    expect(r).toEqual({
      estimatedPoints: 12_000, estimatedDrops: 24, estimatedGrams: 3600, pointsValueVnd: 12000,
      blocks: [{ code: 'ITEM_MONTH_CAP', itemId: 'carton' }, { code: 'POINTS_MONTH_CAP', pointsRemaining: 10_000 }],
      feeEstimate: null, itemCaps: [{ itemId: 'carton', monthRemainingQty: 20, dayRemainingQty: 15 }], pointsMonthRemaining: 10_000,
    });
  });
  it('món nguy hại chưa ACTIVE (pin): không tính điểm, trần để null, vẫn giữ khối ITEM_NOT_ACTIVE; lọc theo CUSTOMER_VISIBLE_ITEMS_WHERE', async () => {
    const pin = { ...line, itemId: 'pin', itemCode: 'BATTERY', itemName: 'Pin đã dùng', unitLabel: 'viên', unitsPerPoint: 10, pointsPerGroup: 1_000, dropsPerUnit: 0, gramsPerUnit: 50, declaredQty: 10, hazardous: true };
    const { svc, hold, prisma } = setup({ blocks: [{ code: 'ITEM_NOT_ACTIVE', itemId: 'pin' }] });
    hold.evaluate.mockResolvedValue({ result: { pointId: 'wh', capDayKey: '2026-10-17', capMonthKey: '2026-10', lines: [line, pin], estimatedPoints: 13_000, estimatedDrops: 24 }, blocks: [{ code: 'ITEM_NOT_ACTIVE', itemId: 'pin' }] });
    const r = await svc.preview('u1', { method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'carton', declaredQty: 12 }, { itemId: 'pin', declaredQty: 10 }] });
    expect(r.estimatedPoints).toBe(12_000);
    expect(r.estimatedGrams).toBe(3600);
    expect(r.itemCaps).toEqual([{ itemId: 'carton', monthRemainingQty: 20, dayRemainingQty: 15 }, { itemId: 'pin', monthRemainingQty: null, dayRemainingQty: null }]);
    expect(r.blocks).toEqual([{ code: 'ITEM_NOT_ACTIVE', itemId: 'pin' }]);
    expect(prisma.wasteItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: { in: ['carton', 'pin'] } }, CUSTOMER_VISIBLE_ITEMS_WHERE] } }));
  });
  it('DROP_OFF passes the body pointId; MAIL_IN and PICKUP pass null', async () => {
    const { svc, hold } = setup();
    await svc.preview('u1', { ...body, method: 'DROP_OFF', pointId: 'p1' });
    await svc.preview('u1', { ...body, method: 'PICKUP', pointId: 'p1' });
    expect(hold.evaluate.mock.calls[0][1]).toMatchObject({ method: 'DROP_OFF', pointId: 'p1' });
    expect(hold.evaluate.mock.calls[1][1]).toMatchObject({ method: 'PICKUP', pointId: null });
  });
  it('MAIL_IN with the default address province', async () => {
    const { svc } = setup({ address: { provinceCode: '79', province: 'TP. Hồ Chí Minh' } });
    expect((await svc.preview('u1', { ...body, method: 'MAIL_IN' })).feeEstimate).toEqual({ zoneName: 'Nội thành HCM', provinceCode: '79', provinceName: 'TP. Hồ Chí Minh', low: 20000, high: 35000 });
  });
  it('MAIL_IN with a body province: name from an address with that code, else a point of that province, else the code', async () => {
    expect((await setup({ codeAddress: { province: 'Cần Thơ' } }).svc.preview('u1', { ...body, method: 'MAIL_IN', provinceCode: '92' })).feeEstimate).toMatchObject({ provinceCode: '92', provinceName: 'Cần Thơ', zoneName: 'Toàn quốc' });
    expect((await setup({ pointProvince: { provinceName: 'Đà Nẵng' } }).svc.preview('u1', { ...body, method: 'MAIL_IN', provinceCode: '48' })).feeEstimate).toMatchObject({ provinceName: 'Đà Nẵng' });
    expect((await setup().svc.preview('u1', { ...body, method: 'MAIL_IN', provinceCode: '48' })).feeEstimate).toMatchObject({ provinceName: '48' });
  });
  it('MAIL_IN without province and without default address -> NEED_PROVINCE appended, feeEstimate null', async () => {
    const r = await setup({ blocks: [{ code: 'BELOW_MIN', missingPoints: 3_000 }] }).svc.preview('u1', { ...body, method: 'MAIL_IN' });
    expect(r.blocks).toEqual([{ code: 'BELOW_MIN', missingPoints: 3_000 }, { code: 'NEED_PROVINCE' }]);
    expect(r.feeEstimate).toBeNull();
  });
  it('PICKUP while Gomdon is off passes lanePickup false (spec 11.5: the lane also needs the Gomdon flag)', async () => {
    const { svc, hold } = setup({ snap: { lanePickup: true } });
    jest.mocked(computeWastePublicFlags).mockResolvedValueOnce({ enabled: true, dropoff: true, mailin: true, pickup: false });
    await svc.preview('u1', { ...body, method: 'PICKUP' });
    expect(hold.evaluate.mock.calls[0][2]).toMatchObject({ lanePickup: false });
  });
  it('DROP_OFF and a method-less preview never read the public flags', async () => {
    const { svc } = setup();
    await svc.preview('u1', { ...body, method: 'DROP_OFF', pointId: 'p1' });
    await svc.preview('u1', body);
    expect(computeWastePublicFlags).not.toHaveBeenCalled();
  });
  it('a MAIL_IN preview keeps the SHIP_LOCKED block; a method-less preview drops it (spec 15.6)', async () => {
    const locked = setup({ blocks: [{ code: 'SHIP_LOCKED' }], address: { provinceCode: '79', province: 'TP. Hồ Chí Minh' } });
    expect((await locked.svc.preview('u1', { ...body, method: 'MAIL_IN' })).blocks).toEqual([{ code: 'SHIP_LOCKED' }]);
    const bare = setup({ blocks: [{ code: 'SHIP_LOCKED' }] });
    expect((await bare.svc.preview('u1', body)).blocks).toEqual([]);
  });
});
