import { describe, it, expect } from 'vitest';
import { ITEM_CARTON, ITEM_MILK, makeRewardCatalog, makeRewardItem } from '../services/waste-test-fixtures';
import * as L from './waste-labels';

describe('câu quy tắc và câu trần (§4.2, §5.1)', () => {
  it('ruleText', () => {
    expect(L.ruleText(ITEM_CARTON)).toBe('1 thùng = 1.000 điểm');
    expect(L.ruleText(ITEM_MILK)).toBe('5 vỏ = 1.000 điểm');
  });
  it('trần tháng + trần ngày', () => {
    expect(L.capSentence(ITEM_CARTON)).toBe('Tối đa 20 thùng mỗi tháng. Mang tới điểm nhận: tối đa 10 thùng mỗi ngày');
  });
  it('chỉ trần tháng', () => { expect(L.capSentence(ITEM_MILK)).toBe('Tối đa 100 vỏ mỗi tháng'); });
  it('chỉ trần ngày', () => { expect(L.capSentence({ ...ITEM_CARTON, monthlyCapQty: null })).toBe('Mang tới điểm nhận: tối đa 10 thùng mỗi ngày'); });
  it('không trần → không có câu (R5.1.37)', () => { expect(L.capSentence({ ...ITEM_CARTON, monthlyCapQty: null, dailyCapQty: null })).toBeNull(); });
  it('nhóm 5 vỏ = 1.000 điểm: thêm N vỏ nữa', () => {
    expect(L.groupProgressText(2, ITEM_MILK)).toBe('thêm 3 vỏ nữa được +1.000 điểm');
    expect(L.groupProgressText(5, ITEM_MILK)).toBe('thêm 5 vỏ nữa được +1.000 điểm');
    expect(L.groupProgressText(0, ITEM_MILK)).toBeNull();
    expect(L.groupProgressText(3, ITEM_CARTON)).toBeNull();
  });
  it('mức quy đổi N đơn vị = M điểm với M khác 1.000 (§5.1: vỏ Tubu 1 vỏ = 2.000 điểm)', () => {
    const shell = { ...ITEM_CARTON, name: 'Vỏ chai Tubu', unitLabel: 'vỏ', unitsPerPoint: 1, pointsPerGroup: 2000 };
    expect(L.ruleText(shell)).toBe('1 vỏ = 2.000 điểm');
    expect(L.groupProgressText(1, shell)).toBeNull();
    const bag = { ...ITEM_MILK, unitsPerPoint: 3, pointsPerGroup: 2000 };
    expect(L.ruleText(bag)).toBe('3 vỏ = 2.000 điểm');
    expect(L.groupProgressText(1, bag)).toBe('thêm 2 vỏ nữa được +2.000 điểm');
  });
});

describe('timeline 4 bước (§4.6) — current = chỉ số bước đang diễn ra, 4 = xong hết', () => {
  const t = (method: 'MAIL_IN' | 'DROP_OFF' | 'PICKUP', status: string, orderCode: string | null = null) =>
    L.timelineFor({ method, status: status as never, orderCode });
  it('nhãn từng đường', () => {
    expect(L.TIMELINE_STEPS.MAIL_IN).toEqual(['Đã gửi', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm']);
    expect(L.TIMELINE_STEPS.DROP_OFF).toEqual(['Đã tạo', 'Mang tới điểm', 'Điểm nhận đếm', 'Cộng điểm']);
    expect(L.TIMELINE_STEPS.PICKUP).toEqual(['Đã tạo', 'Gắn vào đơn', 'Chờ kho nhận', 'Cộng điểm']);
  });
  it.each([
    ['MAIL_IN', 'OPEN', null, 0], ['MAIL_IN', 'IN_TRANSIT', null, 1], ['MAIL_IN', 'RECEIVED', null, 2], ['MAIL_IN', 'COMPLETED', null, 4],
    ['DROP_OFF', 'OPEN', null, 1], ['DROP_OFF', 'COMPLETED', null, 4],
    ['PICKUP', 'OPEN', null, 1], ['PICKUP', 'OPEN', 'TUBU123', 2], ['PICKUP', 'IN_TRANSIT', 'TUBU123', 2], ['PICKUP', 'RECEIVED', 'TUBU123', 2], ['PICKUP', 'COMPLETED', 'TUBU123', 4],
  ] as const)('%s %s (order %s) → %i', (m, s, o, cur) => { expect(t(m, s, o)?.current).toBe(cur); });
  it.each(['REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED'])('%s thay timeline bằng nhãn (null)', (s) => { expect(t('MAIL_IN', s)).toBeNull(); });
});

describe('nhãn trạng thái đóng (§4.6, §14.1)', () => {
  const base = { closeReason: null, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null };
  it.each([
    [{ status: 'REJECTED', rejectionReason: 'HAZARDOUS' }, 'Bị từ chối', 'có vật không nhận'],
    [{ status: 'REJECTED', rejectionReason: 'WET', rejectionNote: 'thùng ướt hết' }, 'Bị từ chối', 'Ướt: thùng ướt hết'],
    [{ status: 'REJECTED', rejectionReason: 'OVERSIZE' }, 'Bị từ chối', 'Quá khổ'],
    [{ status: 'REJECTED', rejectionReason: 'UNPAID_POSTAGE' }, 'Bị từ chối', 'Kiện còn cước phải trả khi nhận'],
    [{ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }, 'Hết hạn giữ chỗ', null],
    [{ status: 'EXPIRED', closeReason: 'PICKUP_NO_SHOW' }, 'Kho chưa nhận được rác thu kèm đơn', null],
    [{ status: 'EXPIRED', closeReason: 'PICKUP_NOT_DISPATCHED' }, 'Tubu chưa sắp xếp được người đến lấy rác thu kèm đơn, xin lỗi bạn', null],
    [{ status: 'EXPIRED', closeReason: 'LOST' }, 'Đã đóng vì thất lạc', null],
    [{ status: 'EXPIRED', closeReason: 'LOST_AT_WAREHOUSE' }, 'Kiện bị thất lạc tại kho Tubu, xin lỗi bạn', null],
    [{ status: 'EXPIRED', closeReason: null }, 'Đã hết hạn', null],
    [{ status: 'EXPIRED', closeReason: 'SHIP_LOCKED' }, 'Đã hết hạn', null],
    [{ status: 'CANCELLED', closeReason: 'HOLD_EXPIRED' }, 'Đã huỷ', null],
    [{ status: 'CANCELLED', closeReason: null }, 'Đã huỷ', 'bạn huỷ'],
    [{ status: 'CANCELLED', closeReason: 'ORDER_CANCELLED' }, 'Đã huỷ', 'đơn mua bị huỷ'],
    [{ status: 'CANCELLED', closeReason: 'SHIP_LOCKED' }, 'Đã huỷ', 'đường kho tạm dừng'],
    [{ status: 'REVERSED', reversedPoints: 4000, reversalReason: 'Kiểm tra lại số lượng' }, 'Đã thu hồi 4.000 điểm', 'Kiểm tra lại số lượng'],
  ])('%o', (over, label, reason) => { expect(L.closedLabel({ ...base, ...over } as never)).toEqual({ label, reason }); });
  it('trạng thái chưa đóng → null', () => { expect(L.closedLabel({ ...base, status: 'OPEN' } as never)).toBeNull(); });
  it('7 lý do nhận thiếu đúng thứ tự §4.10', () => {
    expect(Object.values(L.SHORTFALL_LABELS)).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Khác']);
    expect(Object.keys(L.SHORTFALL_LABELS)).toEqual(['WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OTHER']);
  });
});

describe('lời khoá từ /waste/preview (§4.3)', () => {
  const ctx: L.BlockContext = { items: [ITEM_CARTON, ITEM_MILK], maxOpenRequests: 3, itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 4, dayRemainingQty: 2 }] };
  it.each([
    [{ code: 'MAX_OPEN', openCount: 2 }, 'Bạn đang có 3 yêu cầu chưa xong'],
    [{ code: 'PICKUP_PENDING', pickupRequestCode: 'TR-ABCDE' }, 'Bạn đã có yêu cầu thu kèm TR-ABCDE, hãy gắn vào đơn kế tiếp'],
    [{ code: 'BELOW_MIN', missingPoints: 6000 }, 'cần thêm 6.000 điểm'],
    [{ code: 'MONTH_CAP_FOR_MIN' }, 'tháng này bạn không còn đủ trần cho một gói gửi kho'],
    [{ code: 'NEED_PROVINCE' }, 'Chọn tỉnh để ước tính phí ship'],
    [{ code: 'ITEM_DAY_CAP', itemId: 'item-carton' }, 'Thùng carton: mang tới điểm nhận hôm nay chỉ còn 2 thùng'],
    [{ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }, 'Tháng này Thùng carton chỉ còn 4 thùng'],
    [{ code: 'POINTS_MONTH_CAP', pointsRemaining: 7000 }, 'Tháng này bạn chỉ còn 7.000 điểm trong trần tháng'],
    [{ code: 'POINT_QUOTA_FULL' }, 'Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác'],
    [{ code: 'POINT_UNAVAILABLE' }, 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác'],
    [{ code: 'ITEM_NOT_ACTIVE', itemId: 'item-milk' }, 'Vỏ hộp sữa: món này hiện chưa nhận, hãy bỏ khỏi danh sách'],
    [{ code: 'POINT_MISSING_ITEMS', itemId: 'item-milk' }, 'Điểm này không nhận: Vỏ hộp sữa'],
    [{ code: 'LANE_DISABLED' }, 'Cách giao này đang tạm dừng'],
    [{ code: 'SHIP_LOCKED' }, 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.'],
  ] as const)('%o', (block, text) => { expect(L.blockMessage(block as never, ctx)).toBe(text); });
  it('MONTH_CAP_FOR_MIN nêu đúng đường theo cách giao của thẻ', () => {
    const block = { code: 'MONTH_CAP_FOR_MIN' } as never;
    expect(L.blockMessage(block, { ...ctx, method: 'PICKUP' })).toBe('tháng này bạn không còn đủ trần cho một gói thu kèm đơn');
    expect(L.blockMessage(block, { ...ctx, method: 'MAIL_IN' })).toBe('tháng này bạn không còn đủ trần cho một gói gửi kho');
  });
});

describe('formatLineQty — một dòng tên món và số lượng, không lặp danh từ đơn vị', () => {
  it('tên món đã mở đầu bằng danh từ đơn vị', () => {
    expect(L.formatLineQty('Thùng carton cũ', 3, 'thùng')).toBe('Thùng carton cũ: 3 thùng');
    expect(L.formatLineQty('Vỏ hộp sữa sạch', 5, 'vỏ')).toBe('Vỏ hộp sữa sạch: 5 vỏ');
  });
  it('tên món không mở đầu bằng đơn vị', () => {
    expect(L.formatLineQty('Nilon chống sốc', 2, 'túi lớn')).toBe('Nilon chống sốc: 2 túi lớn');
  });
});

describe('phí ship và giá trị điểm (§4.3, §7.2, §14.5)', () => {
  it('hằng số', () => {
    expect(L.POINT_VALUE_VND).toBe(1);
    expect(L.UNCAPPED_QTY_MAX).toBe(999);
    expect(L.PREVIEW_DEBOUNCE_MS).toBe(300);
  });
  const fee = { zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 45000 };
  it('khoảng phí, không bao giờ một con số', () => { expect(L.feeRangeText(fee)).toBe('30.000đ – 45.000đ'); });
  it('cảnh báo khi giá trị điểm có thể thấp hơn phí (so với mức cao)', () => {
    expect(L.feeExceedsPoints({ pointsValueVnd: 40000, feeEstimate: fee } as never)).toBe(true);
    expect(L.feeExceedsPoints({ pointsValueVnd: 45000, feeEstimate: fee } as never)).toBe(false);
    expect(L.feeExceedsPoints({ pointsValueVnd: 1000, feeEstimate: null } as never)).toBe(false);
  });
});

describe('tiến độ tới quà kế tiếp (§4.1, §16.1: dùng redeemablePoints của máy chủ)', () => {
  it('chọn quà rẻ nhất chưa đủ, bỏ quà đã hết và TREE', () => {
    const c = makeRewardCatalog({ redeemablePoints: 14_000, rewards: [makeRewardItem({ pointsCost: 20_000 }), makeRewardItem({ id: 'x', pointsCost: 10_000 }), makeRewardItem({ id: 'y', pointsCost: 15_000, soldOut: true }), makeRewardItem({ id: 't', kind: 'TREE', pointsCost: 16_000 })] });
    expect(L.nextRewardProgress(c)).toEqual({ rewardName: 'mã giảm giá Miễn phí vận chuyển', cost: 20_000, have: 14_000, missing: 6000 });
    const seed = makeRewardCatalog({ redeemablePoints: 14_000, rewards: [makeRewardItem({ id: 's', kind: 'SEED_PACK', name: 'Gói hạt giống Tubu', voucher: null, pointsCost: 25_000 })] });
    expect(L.nextRewardProgress(seed)?.rewardName).toBe('Gói hạt giống Tubu');
  });
  it('cộng thêm điểm ước tính của lượt đang chọn', () => {
    const c = makeRewardCatalog({ redeemablePoints: 14_000, rewards: [makeRewardItem({ pointsCost: 20_000 })] });
    expect(L.nextRewardProgress(c, 6000)).toBeNull();
    expect(L.nextRewardProgress(c, 2000)?.missing).toBe(4000);
  });
  it('không có catalog → null', () => { expect(L.nextRewardProgress(undefined)).toBeNull(); });
  it('quy điểm thiếu ra đơn vị món ("tương đương khoảng 6 thùng carton")', () => {
    expect(L.equivalentUnits(6000, ITEM_CARTON)).toBe(6);
    expect(L.equivalentUnits(2000, ITEM_MILK)).toBe(10);
  });
});

describe('điểm nhận (§4.4)', () => {
  it('Nhanh nhất chỉ khi < 5 km và có vị trí', () => {
    expect(L.NEAREST_FAST_KM).toBe(5);
    expect(L.isFastest(4.9)).toBe(true);
    expect(L.isFastest(5)).toBe(false);
    expect(L.isFastest(null)).toBe(false);
  });
  const p = { addressLine: '12 Lê Lợi', communeName: 'Phường Bến Thành', provinceName: 'TP.HCM' };
  it('địa chỉ hai cấp, không quận', () => { expect(L.pointAddress(p)).toBe('12 Lê Lợi, Phường Bến Thành, TP.HCM'); });
  it('Chỉ đường = Google Maps theo địa chỉ', () => {
    expect(L.mapsUrl(p)).toBe('https://www.google.com/maps/search/?api=1&query=12%20L%C3%AA%20L%E1%BB%A3i%2C%20Ph%C6%B0%E1%BB%9Dng%20B%E1%BA%BFn%20Th%C3%A0nh%2C%20TP.HCM');
  });
  it('đang mở theo giờ Việt Nam', () => {
    const hours = { MON: [{ open: '08:00', close: '18:00' }] };
    expect(L.isOpenNow(hours, new Date('2026-10-19T02:00:00.000Z'))).toBe(true); // Thứ Hai 09:00 VN
    expect(L.isOpenNow(hours, new Date('2026-10-19T12:00:00.000Z'))).toBe(false); // Thứ Hai 19:00 VN
    expect(L.isOpenNow(hours, new Date('2026-10-20T02:00:00.000Z'))).toBe(false); // Thứ Ba
  });
  it('dd/mm theo giờ VN', () => { expect(L.dayMonth('2026-10-24T17:30:00.000Z')).toBe('25/10'); });
});
