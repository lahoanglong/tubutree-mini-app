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
  describe('HOME_PICKUP (shipper lấy rác tận nhà)', () => {
    const home = (o: Record<string, unknown> = {}) =>
      row({
        method: 'HOME_PICKUP', status: 'OPEN', carrier: 'BestExpress', trackingCode: 'BE77', gomdonStatus: '1', declaredWeightGrams: 2500,
        shipFeeVnd: 25_000, shipFeePointsUsed: 10_000, shipFeeCodVnd: 15_000, shipFeePointsRefunded: null, receivedAt: null, completedAt: null, pointsAwarded: null,
        pickupAddress: { addressId: 'a1', recipient: 'Lan', phone: '0901234567', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'Thành phố Hồ Chí Minh' },
        shippingHistory: [
          { at: '2026-10-17T03:00:05.000Z', status: '1' },
          { at: '2026-10-17T05:00:00.000Z', status: '3' },
          { at: '2026-10-17T07:00:00.000Z', status: '4' },
          { at: '2026-10-17T08:00:00.000Z', status: '5' },
        ],
        ...o,
      });

    it('chi tiết và danh sách có thêm homePickup, các phương thức khác không có khoá này', () => {
      expect(toRequestDetail(row(), true)).not.toHaveProperty('homePickup');
      expect(toRequestSummary(row())).not.toHaveProperty('homePickup');
      expect(toRequestDetail(home(), true).homePickup).toBeDefined();
      expect(toRequestSummary(home()).homePickup).toBeDefined();
    });

    it('homePickup chỉ có các khoá cho phép, địa chỉ rút gọn không kèm tên và số điện thoại', () => {
      const dto = toRequestDetail(home(), true).homePickup!;
      expect(Object.keys(dto).sort()).toEqual([
        'declaredWeightGrams', 'gomdonStatus', 'pickupAddressText', 'shipFeeCashMethod', 'shipFeeCashPaid', 'shipFeeCashRefundedVnd', 'shipFeeCashVnd', 'shipFeeCodVnd', 'shipFeePointsRefunded', 'shipFeePointsUsed', 'shipFeeVnd', 'statusText', 'timeline',
      ]);
      expect(dto).toMatchObject({
        gomdonStatus: '1', statusText: 'Đã tạo đơn, chờ bưu tá tới lấy rác', shipFeeVnd: 25_000, shipFeePointsUsed: 10_000, shipFeeCashVnd: 0, shipFeeCashMethod: null,
        shipFeeCashPaid: false, shipFeeCashRefundedVnd: 0, shipFeeCodVnd: 15_000,
        shipFeePointsRefunded: 0, declaredWeightGrams: 2500, pickupAddressText: '1 Lê Lợi, Phường Bến Nghé, Thành phố Hồ Chí Minh',
      });
      const json = JSON.stringify(toRequestDetail(home({ shipFeeBankRef: 'FT999' }), true));
      expect(json).not.toContain('Lan');
      expect(json).not.toContain('0901234567');
      expect(json).not.toContain('shippingHistory');
      expect(json).not.toContain('gomdonOrderId');
      expect(json).not.toContain('shipFeeBankRef');
      expect(json).not.toContain('FT999');
    });

    it('timeline: mốc tạo đơn, rồi từng mốc Gomdon; 4 và 5 cùng câu nên chỉ giữ một', () => {
      const { timeline } = toRequestDetail(home(), true).homePickup!;
      expect(timeline.map((t) => t.text)).toEqual(['Đã tạo đơn thu gom', 'Bưu tá đã lấy rác', 'Đang về kho Tubu']);
      expect(timeline[0]!.at).toBe('2026-10-17T03:00:00.000Z');
    });

    it('timeline cuối: kho nhận rồi cộng điểm khi COMPLETED', () => {
      const dto = toRequestDetail(home({ status: 'COMPLETED', gomdonStatus: '7', receivedAt: D('2026-10-18T01:00:00Z'), completedAt: D('2026-10-18T02:00:00Z'), pointsAwarded: 6_000 }), true).homePickup!;
      expect(dto.statusText).toBe('Kho đã kiểm nhận và cộng 6.000 Điểm Xanh');
      expect(dto.timeline.at(-2)!.text).toBe('Kho Tubu đã nhận rác, đang kiểm đếm');
      expect(dto.timeline.at(-1)!.text).toBe('Kho đã kiểm nhận và cộng 6.000 Điểm Xanh');
    });

    it('phiếu huỷ hoặc hết hạn vì bưu tá chưa lấy được: câu trạng thái đúng, số điểm đã hoàn hiện ra', () => {
      expect(toRequestDetail(home({ status: 'CANCELLED', gomdonStatus: '2', shipFeePointsRefunded: 10_000 }), true).homePickup).toMatchObject({ statusText: 'Đơn thu gom đã huỷ', shipFeePointsRefunded: 10_000 });
      expect(toRequestDetail(home({ status: 'EXPIRED', gomdonStatus: '10', closeReason: 'PICKUP_NO_SHOW' }), true).homePickup!.statusText).toBe('Bưu tá chưa lấy được rác');
      expect(toRequestDetail(home({ status: 'EXPIRED', gomdonStatus: null, closeReason: 'HOLD_EXPIRED' }), true).homePickup!.statusText).toBe('Yêu cầu đã đóng');
      expect(toRequestDetail(home({ status: 'EXPIRED', gomdonStatus: null, closeReason: 'FEE_UNPAID' }), true).homePickup!.statusText).toBe('Quá hạn chuyển khoản phí lấy rác');
      expect(toRequestDetail(home({ status: 'OPEN', gomdonStatus: null, shippingHistory: null, shipFeeCashVnd: 17_000, shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null }), true).homePickup).toMatchObject({
        statusText: 'Chờ bạn chuyển khoản phí lấy rác',
        shipFeeCashVnd: 17_000,
        shipFeeCashMethod: 'BANK_TRANSFER',
        shipFeeCashPaid: false,
      });
    });

    it('chưa có vận đơn hoặc Gomdon báo mã lạ: câu chờ tạo vận đơn, không lộ mã nội bộ', () => {
      expect(toRequestDetail(home({ gomdonStatus: null, shippingHistory: null }), true).homePickup).toMatchObject({ statusText: 'Đang tạo vận đơn' });
      expect(toRequestDetail(home({ gomdonStatus: 'NEEDS_MANUAL_CHECK' }), true).homePickup!.statusText).toBe('Tubu đang kiểm tra vận đơn của bạn');
      expect(toRequestDetail(home({ gomdonStatus: '99' }), true).homePickup!.statusText).toBe('Đang tạo vận đơn');
    });

    it('không sửa được (cân nặng, địa chỉ, phí đã khoá trên vận đơn), huỷ được khi còn OPEN', () => {
      expect(toRequestDetail(home({ trackingCode: null }), true)).toMatchObject({ editable: false, cancellable: true });
      expect(toRequestDetail(home({ status: 'IN_TRANSIT', gomdonStatus: '3' }), true)).toMatchObject({ editable: false, cancellable: false });
    });
  });
});
