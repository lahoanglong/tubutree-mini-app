import { toRequestDetail, toRequestSummary, type WasteRequestFull } from './waste-request.mapper';

const D = (s: string) => new Date(s);
const line = (o: Record<string, unknown> = {}) => ({ id: 'l1', requestId: 'r1', itemId: 'carton', itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300, declaredQty: 10, receivedQty: 8, shortfallReason: 'WET', pointsAwarded: 8_000, ...o });
const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1', code: 'TR-A2C4E', userId: 'u1', method: 'MAIL_IN', status: 'COMPLETED', pointId: 'wh', orderId: null,
  carrier: 'GHTK', trackingCode: 'S123', trackingNorm: 'S123', trackingConflict: true, estimatedPoints: 10_000, estimatedDrops: 20,
  capDayKey: '2026-10-17', capMonthKey: '2026-10', expiresAt: null, inTransitAt: D('2026-10-18T01:00:00Z'), receivedAt: D('2026-10-20T01:00:00Z'),
  completedAt: D('2026-10-20T02:00:00Z'), closedAt: D('2026-10-20T02:00:00Z'), closeReason: null, confirmedByUserId: 's1', pointsAwarded: 8_000, dropsAwarded: 16,
  receivedWeightGrams: 2500, carrierCostVnd: 30000, rejectionReason: null, rejectionNote: null, reversedAt: null, reversedByUserId: null, reversalReason: null,
  reversalShortfallPoints: null, idempotencyKey: 'key-12345678', consentAt: D('2026-10-17T03:00:00Z'), consentVersion: '2026-10-17.1',
  createdAt: D('2026-10-17T03:00:00Z'), updatedAt: D('2026-10-20T02:00:00Z'),
  point: { id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu TP.HCM', addressLine: '12 Đường A', communeName: 'Phường B', provinceName: 'TP.HCM', phone: '0281234567', openingHours: { MON: [{ open: '08:00', close: '17:00' }] } },
  order: null, lines: [line()], ...o,
}) as unknown as WasteRequestFull;

const DETAIL_KEYS = ['cancellable', 'carrier', 'closeReason', 'closedAt', 'code', 'completedAt', 'createdAt', 'dropsAwarded', 'editable', 'estimatedPoints', 'expiresAt', 'id', 'impactGrams', 'inTransitAt', 'lines', 'method', 'orderCode', 'orderId', 'point', 'pointAvailable', 'pointName', 'pointsAwarded', 'receivedAt', 'rejectionNote', 'rejectionReason', 'reversalReason', 'reversedPoints', 'status', 'trackingCode'];
const SUMMARY_KEYS = ['closeReason', 'code', 'createdAt', 'estimatedPoints', 'expiresAt', 'id', 'lines', 'method', 'orderCode', 'pointName', 'pointsAwarded', 'status'];

describe('waste request mapper (allow-list, spec 15.1)', () => {
  it('detail has exactly the allowed keys; trackingConflict true never leaks; no internal field anywhere', () => {
    const dto = toRequestDetail(row(), true);
    expect(Object.keys(dto).sort()).toEqual(DETAIL_KEYS);
    const json = JSON.stringify(dto);
    for (const k of ['trackingConflict', 'trackingNorm', 'confirmedByUserId', 'reversedByUserId', 'carrierCostVnd', 'reversalShortfallPoints', 'idempotencyKey', 'capDayKey', 'capMonthKey', 'userId', 'receivedWeightGrams', 'consentVersion']) {
      expect(json).not.toContain(`"${k}"`);
    }
    expect(Object.keys(dto.lines[0]!).sort()).toEqual(['declaredQty', 'dropsPerUnit', 'gramsPerUnit', 'itemId', 'itemName', 'pointsAwarded', 'pointsPerGroup', 'receivedQty', 'shortfallReason', 'unitLabel', 'unitsPerPoint']);
    expect(dto.point).toEqual({ id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu TP.HCM', addressLine: '12 Đường A', communeName: 'Phường B', provinceName: 'TP.HCM', phone: '0281234567', openingHours: { MON: [{ open: '08:00', close: '17:00' }] } });
  });
  it('summary has exactly the allowed keys and three-field lines', () => {
    const dto = toRequestSummary(row());
    expect(Object.keys(dto).sort()).toEqual(SUMMARY_KEYS);
    expect(dto.lines).toEqual([{ itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 10 }]);
    expect(dto).toMatchObject({ pointName: 'Kho Tubu TP.HCM', orderCode: null, createdAt: '2026-10-17T03:00:00.000Z', expiresAt: null });
  });
  it('impactGrams only for COMPLETED with every line weighed (spec 4.7, 5.7)', () => {
    expect(toRequestDetail(row(), true).impactGrams).toBe(2400);
    expect(toRequestDetail(row({ lines: [line(), line({ id: 'l2', itemId: 'film', gramsPerUnit: null })] }), true).impactGrams).toBeNull();
    expect(toRequestDetail(row({ status: 'REVERSED' }), true).impactGrams).toBeNull();
  });
  it('reversedPoints = pointsAwarded - reversalShortfallPoints, only when REVERSED', () => {
    expect(toRequestDetail(row({ status: 'REVERSED', reversalShortfallPoints: 3_000, reversalReason: 'Gian lận' }), true)).toMatchObject({ reversedPoints: 5_000, reversalReason: 'Gian lận' });
    expect(toRequestDetail(row(), true).reversedPoints).toBeNull();
  });
  it.each<[string, Record<string, unknown>, boolean, boolean]>([
    ['OPEN, no order, no tracking', { status: 'OPEN', trackingCode: null, carrier: null }, true, true],
    ['OPEN with tracking (IN_TRANSIT not yet) is not editable', { status: 'OPEN', trackingCode: 'S1' }, false, true],
    ['OPEN attached PICKUP', { status: 'OPEN', method: 'PICKUP', orderId: 'o1', order: { code: 'DH1' }, trackingCode: null }, false, false],
    ['IN_TRANSIT', { status: 'IN_TRANSIT' }, false, false],
  ])('editable/cancellable: %s', (_n, o, editable, cancellable) => {
    expect(toRequestDetail(row(o), true)).toMatchObject({ editable, cancellable });
  });
  it('closeReason and pointAvailable pass through (cancel cause: SHIP_LOCKED, ORDER_CANCELLED, null = customer)', () => {
    expect(toRequestDetail(row({ status: 'CANCELLED', closeReason: 'SHIP_LOCKED' }), false)).toMatchObject({ closeReason: 'SHIP_LOCKED', pointAvailable: false });
  });
});
