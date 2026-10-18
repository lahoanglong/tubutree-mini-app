import { describe, expect, it } from 'vitest';
import {
  blockMessage,
  capSentence,
  closedLabel,
  equivalentUnits,
  feeExceedsPoints,
  feeRangeText,
  formatLineQty,
  groupProgressText,
  impactLine,
  isOpenNow,
  mapsUrl,
  nextRewardProgress,
  pointAddress,
  ruleText,
  timelineFor,
} from './recycle-labels';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { ITEM_CARTON, ITEM_MILK, makeWastePoint } from './recycle-fixtures';

describe('nhãn Đổi rác', () => {
  it('impactLine: dưới 50 g không có dòng, từ 50 g làm tròn một chữ số', () => {
    expect(impactLine(null)).toBeNull();
    expect(impactLine(49)).toBeNull();
    expect(impactLine(50)).toBe('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu');
    expect(impactLine(1940)).toBe('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu');
  });
  it('ruleText và formatLineQty', () => {
    expect(ruleText(ITEM_CARTON)).toBe('1 thùng = 1.000 điểm');
    expect(ruleText(ITEM_MILK)).toBe('5 vỏ = 1.000 điểm');
    expect(formatLineQty('Thùng carton cũ', 3, 'thùng')).toBe('Thùng carton cũ: 3 thùng');
  });
  it('timelineFor: đường kho đi 0/1/2, đóng thì null, xong là bước 4', () => {
    expect(timelineFor({ method: 'MAIL_IN', status: 'IN_TRANSIT', orderCode: null })?.current).toBe(1);
    expect(timelineFor({ method: 'DROP_OFF', status: 'OPEN', orderCode: null })?.current).toBe(1);
    expect(timelineFor({ method: 'PICKUP', status: 'OPEN', orderCode: 'TB-1' })?.current).toBe(2);
    expect(timelineFor({ method: 'DROP_OFF', status: 'COMPLETED', orderCode: null })?.current).toBe(4);
    expect(timelineFor({ method: 'DROP_OFF', status: 'CANCELLED', orderCode: null })).toBeNull();
  });
  it('closedLabel: từ chối kèm lý do, hết hạn, huỷ, thu hồi', () => {
    const base = { closeReason: null, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null };
    expect(closedLabel({ ...base, status: 'REJECTED', rejectionReason: 'WET', rejectionNote: 'thấm nước' })).toEqual({ label: 'Bị từ chối', reason: 'Ướt: thấm nước' });
    expect(closedLabel({ ...base, status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' })).toEqual({ label: 'Hết hạn giữ chỗ', reason: null });
    expect(closedLabel({ ...base, status: 'CANCELLED' })).toEqual({ label: 'Đã huỷ', reason: 'bạn huỷ' });
    expect(closedLabel({ ...base, status: 'REVERSED', reversedPoints: 4000, reversalReason: 'nhầm' })).toEqual({ label: 'Đã thu hồi 4.000 điểm', reason: 'nhầm' });
    expect(closedLabel({ ...base, status: 'OPEN' })).toBeNull();
  });
  it('nextRewardProgress bỏ quà hết hàng và cây, equivalentUnits làm tròn lên', () => {
    const p = nextRewardProgress(makeRewardCatalog({ redeemablePoints: 14_000 }));
    expect(p).toMatchObject({ rewardName: 'mã giảm giá Miễn phí vận chuyển', missing: 6000, have: 14_000 });
    expect(nextRewardProgress(undefined)).toBeNull();
    expect(equivalentUnits(6000, ITEM_CARTON)).toBe(6);
    expect(equivalentUnits(1500, ITEM_MILK)).toBe(10);
  });

  it('capSentence nối trần tháng và trần ngày, món không có trần thì null', () => {
    expect(capSentence(ITEM_CARTON)).toBe('Tối đa 20 thùng mỗi tháng. Mang tới điểm nhận: tối đa 10 thùng mỗi ngày');
    expect(capSentence({ ...ITEM_CARTON, monthlyCapQty: null, dailyCapQty: null })).toBeNull();
  });
  it('groupProgressText chỉ cho món nhóm và khi đã có số lượng', () => {
    expect(groupProgressText(0, ITEM_MILK)).toBeNull();
    expect(groupProgressText(2, ITEM_CARTON)).toBeNull();
    expect(groupProgressText(2, ITEM_MILK)).toBe('thêm 3 vỏ nữa được +1.000 điểm');
  });
  it('blockMessage: câu của từng mã khoá', () => {
    const ctx = { items: [ITEM_CARTON], maxOpenRequests: 3, itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 1, dayRemainingQty: 2 }] };
    expect(blockMessage({ code: 'MAX_OPEN' }, ctx)).toBe('Bạn đang có 3 yêu cầu chưa xong');
    expect(blockMessage({ code: 'BELOW_MIN', missingPoints: 6000 }, ctx)).toBe('cần thêm 6.000 điểm');
    expect(blockMessage({ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }, ctx)).toBe('Tháng này Thùng carton chỉ còn 1 thùng');
    expect(blockMessage({ code: 'ITEM_DAY_CAP', itemId: 'item-carton' }, ctx)).toBe('Thùng carton: mang tới điểm nhận hôm nay chỉ còn 2 thùng');
    expect(blockMessage({ code: 'POINTS_MONTH_CAP', pointsRemaining: 60_000 }, ctx)).toBe('Tháng này bạn chỉ còn 60.000 điểm trong trần tháng');
    expect(blockMessage({ code: 'MONTH_CAP_FOR_MIN' }, { ...ctx, method: 'PICKUP' })).toBe('tháng này bạn không còn đủ trần cho một gói thu kèm đơn');
    expect(blockMessage({ code: 'MONTH_CAP_FOR_MIN' }, { ...ctx, method: 'MAIL_IN' })).toBe('tháng này bạn không còn đủ trần cho một gói gửi kho');
    expect(blockMessage({ code: 'NEED_PROVINCE' }, ctx)).toBe('Chọn tỉnh để ước tính phí ship');
    expect(blockMessage({ code: 'SHIP_LOCKED' }, ctx)).toBe('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.');
  });
  it('phí ship: khoảng giá và so với giá trị điểm theo mức cao', () => {
    const fee = { zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 45000 };
    expect(feeRangeText(fee)).toBe('30.000đ – 45.000đ');
    expect(feeExceedsPoints({ pointsValueVnd: 40000, feeEstimate: fee })).toBe(true);
    expect(feeExceedsPoints({ pointsValueVnd: 45000, feeEstimate: fee })).toBe(false);
    expect(feeExceedsPoints({ pointsValueVnd: 1, feeEstimate: null })).toBe(false);
  });
  it('isOpenNow theo giờ VN, không theo múi giờ máy', () => {
    const hours = { MON: [{ open: '08:00', close: '18:00' }] };
    expect(isOpenNow(hours, new Date('2026-10-19T02:00:00.000Z'))).toBe(true);
    expect(isOpenNow(hours, new Date('2026-10-19T12:00:00.000Z'))).toBe(false);
    expect(isOpenNow(hours, new Date('2026-10-20T02:00:00.000Z'))).toBe(false);
  });
  it('pointAddress và mapsUrl', () => {
    const p = makeWastePoint();
    expect(pointAddress(p)).toBe('12 Lê Lợi, Phường Bến Thành, TP.HCM');
    expect(mapsUrl(p)).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('12 Lê Lợi, Phường Bến Thành, TP.HCM')}`);
  });
});
