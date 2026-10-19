import { describe, expect, it } from 'vitest';
import {
  blockMessage,
  capSentence,
  SHORTFALL_LABELS,
  closedLabel,
  dayMonth,
  equivalentUnits,
  feeExceedsPoints,
  feeRangeText,
  formatLineQty,
  groupProgressText,
  impactLine,
  isOpenNow,
  isRequestPaused,
  monthRemainingText,
  requestStatusText,
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
    expect(closedLabel({ ...base, status: 'CANCELLED' })).toEqual({ label: 'Đã huỷ', reason: 'Bạn đã huỷ yêu cầu này' });
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
    expect(blockMessage({ code: 'BELOW_MIN', missingPoints: 6000 }, ctx)).toBe('Cần thêm 6.000 điểm');
    expect(blockMessage({ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }, ctx)).toBe('Tháng này Thùng carton chỉ còn 1 thùng');
    expect(blockMessage({ code: 'ITEM_DAY_CAP', itemId: 'item-carton' }, ctx)).toBe('Thùng carton: mang tới điểm nhận hôm nay chỉ còn 2 thùng');
    expect(blockMessage({ code: 'POINTS_MONTH_CAP', pointsRemaining: 60_000 }, ctx)).toBe('Tháng này bạn chỉ còn 60.000 điểm trong trần tháng');
    expect(blockMessage({ code: 'MONTH_CAP_FOR_MIN' }, { ...ctx, method: 'PICKUP' })).toBe('Tháng này bạn không còn đủ trần cho một gói thu kèm đơn');
    expect(blockMessage({ code: 'MONTH_CAP_FOR_MIN' }, { ...ctx, method: 'MAIL_IN' })).toBe('Tháng này bạn không còn đủ trần cho một gói gửi kho');
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
  it('dayMonth theo giờ Việt Nam: 17:30 UTC đã sang ngày hôm sau', () => {
    expect(dayMonth('2026-10-24T17:30:00.000Z')).toBe('25/10');
    expect(dayMonth('2026-01-05T00:00:00.000Z')).toBe('05/01');
  });
  it('SHORTFALL_LABELS: lý do kho nhận thiếu, không có lý do chỉ có ở cửa kho', () => {
    expect(SHORTFALL_LABELS.WET).toBe('Ướt');
    expect(SHORTFALL_LABELS.NOT_ACCEPTED).toBe('Không nhận');
    expect(Object.keys(SHORTFALL_LABELS)).not.toContain('UNPAID_POSTAGE');
  });
});

describe('trạng thái một dòng và tạm dừng (đồng bộ Mini App)', () => {
  const base = { method: 'DROP_OFF', status: 'OPEN', closeReason: null, orderCode: null, pointsAwarded: null } as const;
  it.each([
    [{ method: 'DROP_OFF', status: 'OPEN' }, 'Chờ bạn mang tới'],
    [{ method: 'MAIL_IN', status: 'OPEN' }, 'Chờ bạn gửi kiện'],
    [{ method: 'PICKUP', status: 'OPEN', orderCode: null }, 'Chờ gắn vào đơn'],
    [{ method: 'PICKUP', status: 'OPEN', orderCode: 'TB123' }, 'Chờ kho nhận'],
    [{ method: 'MAIL_IN', status: 'IN_TRANSIT' }, 'Đang vận chuyển'],
    [{ method: 'MAIL_IN', status: 'RECEIVED' }, 'Kho đã nhận, đang đếm'],
    [{ status: 'COMPLETED', pointsAwarded: 4000 }, 'Đã cộng 4.000 điểm'],
    [{ status: 'COMPLETED', pointsAwarded: 0 }, 'Chưa đủ để cộng điểm'],
    [{ status: 'REJECTED' }, 'Bị từ chối'],
    [{ status: 'CANCELLED' }, 'Đã huỷ'],
    [{ status: 'REVERSED' }, 'Đã thu hồi điểm'],
    [{ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }, 'Hết hạn giữ chỗ'],
  ])('%o', (over, text) => {
    expect(requestStatusText({ ...base, ...over } as never)).toBe(text);
  });
  it('khách bị khoá: RECEIVED đọc "Đang chờ Tubu xem lại", kể cả khi tạm dừng', () => {
    const r = { ...base, method: 'MAIL_IN', status: 'RECEIVED' } as never;
    expect(requestStatusText(r, { blocked: true })).toBe('Đang chờ Tubu xem lại');
    expect(requestStatusText(r, { blocked: true, paused: true })).toBe('Đang chờ Tubu xem lại');
  });
  it('tạm dừng chỉ đổi nhãn của điểm nhận và thu kèm chưa gắn đơn', () => {
    expect(requestStatusText({ ...base } as never, { paused: true })).toBe('Đang tạm dừng');
    expect(requestStatusText({ ...base, method: 'PICKUP' } as never, { paused: true })).toBe('Đang tạm dừng');
    expect(requestStatusText({ ...base, method: 'PICKUP', orderCode: 'TB123' } as never, { paused: true })).toBe('Chờ kho nhận');
    expect(requestStatusText({ ...base, method: 'MAIL_IN' } as never, { paused: true })).toBe('Chờ bạn gửi kiện');
  });
  const cfgOn = { enabled: true, pickup: true, isLoaded: true };
  const drop = { method: 'DROP_OFF', status: 'OPEN', orderCode: null } as const;
  const unattached = { method: 'PICKUP', status: 'OPEN', orderCode: null } as const;
  const attached = { method: 'PICKUP', status: 'OPEN', orderCode: 'TB123' } as const;
  const mail = { method: 'MAIL_IN', status: 'OPEN', orderCode: null } as const;
  it.each([
    ['chương trình tắt', { programmeEnabled: false, cfg: cfgOn }, true, true],
    ['cờ công khai tắt', { cfg: { ...cfgOn, enabled: false } }, true, false],
    ['khách bị khoá', { blocked: true, cfg: cfgOn }, true, true],
    ['khoá đường kho', { shipLockedAt: '2026-10-01T00:00:00.000Z', cfg: cfgOn }, false, true],
    ['cờ pickup tắt', { cfg: { ...cfgOn, pickup: false } }, false, true],
  ] as const)('isRequestPaused: %s', (_n, facts, dropPaused, pickupPaused) => {
    expect(isRequestPaused(drop, facts)).toBe(dropPaused);
    expect(isRequestPaused(unattached, facts)).toBe(pickupPaused);
    expect(isRequestPaused(attached, facts)).toBe(false);
    expect(isRequestPaused(mail, facts)).toBe(false);
    expect(isRequestPaused({ ...drop, status: 'RECEIVED' }, facts)).toBe(false);
  });
  it('không lý do nào, hoặc cấu hình chưa tải, thì không tạm dừng', () => {
    expect(isRequestPaused(drop, { cfg: cfgOn })).toBe(false);
    expect(isRequestPaused(drop, { cfg: { enabled: false, pickup: false, isLoaded: false } })).toBe(false);
  });
});

describe('monthRemainingText', () => {
  const item = { monthlyCapQty: 120, unitLabel: 'chai' };
  it('hết trần, còn ít hơn trần, còn nguyên trần', () => {
    expect(monthRemainingText({ ...item, monthRemainingQty: 0 })).toBe('Tháng này bạn đã đủ trần cho món này');
    expect(monthRemainingText({ ...item, monthRemainingQty: 45 })).toBe('Tháng này còn 45 chai');
    expect(monthRemainingText({ ...item, monthRemainingQty: 120 })).toBeNull();
    expect(monthRemainingText({ monthlyCapQty: null, unitLabel: 'chai', monthRemainingQty: null })).toBeNull();
  });
});

describe('nhãn huỷ và quà kế tiếp (đồng bộ Mini App)', () => {
  const base = { rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null };
  it('lý do huỷ viết hoa đầu câu', () => {
    expect(closedLabel({ ...base, status: 'CANCELLED', closeReason: 'ORDER_CANCELLED' })?.reason).toBe('Đơn mua đã bị huỷ');
    expect(closedLabel({ ...base, status: 'CANCELLED', closeReason: 'SHIP_LOCKED' })?.reason).toBe('Đường kho đang tạm dừng');
  });
  it('mã giảm tên bắt đầu bằng "Giảm" không lặp chữ giảm giá', () => {
    const cat = { redeemablePoints: 14_000, rewards: [{ id: 'v', kind: 'VOUCHER', name: 'Giảm 50.000đ', pointsCost: 20_000, sortOrder: 1, soldOut: false }] };
    expect(nextRewardProgress(cat as never)?.rewardName).toBe('mã giảm 50.000đ');
  });
});
