import { describe, it, expect } from 'vitest';
import {
  checkInView,
  lockedPointsNote,
  memberCardHint,
  pointsReasonLabel,
  rewardButtonLabel,
  tierProgressPercent,
  type CheckInStatusResponse,
  type LoyaltyOverview,
  type MemberCardResponse,
} from './account-api';

/**
 * View helper cho trang Hạng thành viên (loyalty.tsx). Tách thành hàm thuần để test được các lỗi
 * bản WIP: lịch sử điểm hiện mã thô "DAILY_CHECKIN:DAY_3", thanh tiến độ tính theo SỐ DƯ (có cả
 * điểm danh — không tính xét hạng), thẻ thành viên hứa "tích điểm tại quầy" khi backend đang tắt.
 */

describe('pointsReasonLabel', () => {
  it.each([
    ['DAILY_CHECKIN:DAY_3', 'Điểm danh hằng ngày'],
    ['DAILY_CHECKIN', 'Điểm danh hằng ngày'],
    ['POS_OFFLINE_ORDER:HD-001', 'Tích điểm mua tại cửa hàng'],
    ['LOYALTY_REDEEM_VOUCHER:reward-discount-50k', 'Đổi điểm lấy voucher'],
    ['ORDER_DELIVERED:TB123', 'Tích điểm từ đơn hàng'],
    ['ORDER_REDEEM:TB123', 'Dùng điểm khi thanh toán'],
    ['ORDER_REVERSED:TB123', 'Hoàn ngược điểm (hủy/trả)'],
    ['ORDER_REFUND_POINTS:TB123', 'Hoàn lại điểm đã dùng'],
    ['POINTS_EXPIRED', 'Điểm hết hạn'],
    ['GAME_SPIN_WIN:p1', 'Phần thưởng Vườn Xanh'],
    ['SEASONPASS:s1:3:FREE', 'Phần thưởng Vườn Xanh'],
    ['REVIEW:ca-phe', 'Đánh giá sản phẩm'],
  ])('%s → %s', (reason, label) => {
    expect(pointsReasonLabel(reason)).toBe(label);
  });

  it('reason lạ không lộ mã kỹ thuật ra UI', () => {
    expect(pointsReasonLabel('SOMETHING_NEW:XYZ')).toBe('Điều chỉnh Điểm Xanh');
  });
});

const status = (over: Partial<CheckInStatusResponse> = {}): CheckInStatusResponse => ({
  checkedInToday: false,
  streakDays: 3,
  currentCycleDay: 4,
  todayPoints: 4,
  rewards: [1, 2, 3, 4, 5, 6, 7].map((p, i) => ({ day: i + 1, points: p, claimed: i < 3, isToday: i === 3 })),
  ...over,
});

describe('checkInView', () => {
  it('chưa điểm danh → nút ghi ĐÚNG số điểm sẽ nhận hôm nay (ô isToday)', () => {
    expect(checkInView(status())).toEqual({ canCheckIn: true, buttonLabel: 'Điểm danh +4' });
  });

  it('đã điểm danh → khoá nút', () => {
    expect(checkInView(status({ checkedInToday: true, currentCycleDay: 3, todayPoints: 3 }))).toEqual({
      canCheckIn: false,
      buttonLabel: 'Đã điểm danh',
    });
  });

  it('API cũ thiếu todayPoints → lấy từ ô isToday', () => {
    const s = status();
    delete (s as Partial<CheckInStatusResponse>).todayPoints;
    expect(checkInView(s).buttonLabel).toBe('Điểm danh +4');
  });

  it('ô hôm nay 0 điểm → không hứa "+0"', () => {
    expect(checkInView(status({ todayPoints: 0 })).buttonLabel).toBe('Điểm danh');
  });
});

const overview = (over: Partial<LoyaltyOverview> = {}): LoyaltyOverview => ({
  pointsBalance: 900,
  tierPoints: 300,
  tier: { id: 'mam', name: 'Mầm Xanh', multiplier: 1, perks: [] },
  nextTier: { id: 'loc', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 200 },
  tiers: [
    { id: 'mam', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 'loc', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
  ],
  ...over,
});

describe('tierProgressPercent', () => {
  it('tính theo điểm XÉT HẠNG (tierPoints), không theo số dư (số dư có điểm danh/POS)', () => {
    // 300/500 = 60%; nếu tính theo số dư 900 sẽ ra 100% dù còn 200 điểm mới lên hạng.
    expect(tierProgressPercent(overview())).toBe(60);
  });

  it('tính từ sàn hạng hiện tại → ngưỡng hạng kế', () => {
    const ov = overview({
      tierPoints: 1250,
      tier: { id: 'loc', name: 'Lộc Biếc', multiplier: 1.2, perks: [] },
      nextTier: { id: 'dai', name: 'Đại Thụ', minPoints: 2000, pointsToGo: 750 },
      tiers: [
        { id: 'mam', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
        { id: 'loc', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
        { id: 'dai', name: 'Đại Thụ', minPoints: 2000, multiplier: 1.5 },
      ],
    });
    expect(tierProgressPercent(ov)).toBe(50);
  });

  it('hạng cao nhất → 100', () => {
    expect(tierProgressPercent(overview({ nextTier: null }))).toBe(100);
  });

  it('API cũ thiếu tierPoints → quay về số dư, kẹp 0..100', () => {
    const ov = overview({ pointsBalance: 900 });
    delete (ov as Partial<LoyaltyOverview>).tierPoints;
    expect(tierProgressPercent(ov)).toBe(100);
  });
});

describe('memberCardHint', () => {
  const card = (posCreditEnabled: boolean): MemberCardResponse => ({
    memberCode: 'TUBUAB12CD34',
    name: 'Khách',
    phone: '098****321',
    tierName: 'Mầm Xanh',
    tierMultiplier: 1,
    pointsBalance: 0,
    posCreditEnabled,
  });

  it('backend BẬT tích điểm tại quầy → hướng dẫn đưa mã cho thu ngân', () => {
    expect(memberCardHint(card(true))).toMatch(/thu ngân/);
  });

  it('backend TẮT → KHÔNG hứa tích điểm tại cửa hàng', () => {
    const hint = memberCardHint(card(false));
    expect(hint).not.toMatch(/thu ngân/);
    expect(hint).toMatch(/chưa/i);
  });
});

// Điểm từ đơn mới giao (còn trong hạn đổi/trả) / đơn đang đổi-trả chưa đổi quà được — backend chặn ở
// redeemReward; UI phải nói rõ vì sao nút "Đổi ngay" tắt dù số dư đủ, thay vì báo "Cần X điểm".
describe('lockedPointsNote', () => {
  it('không có điểm khoá / API cũ không trả → không hiện gì', () => {
    expect(lockedPointsNote(overview())).toBeNull();
    expect(lockedPointsNote(overview({ lockedPoints: 0 }))).toBeNull();
  });

  it('điểm đơn mới giao → nêu số điểm + ngày mở (giờ VN)', () => {
    // 2026-10-03T17:30Z = 00:30 ngày 04/10 giờ VN.
    const note = lockedPointsNote(
      overview({ pointsBalance: 100, lockedPoints: 60, lockedReturnPoints: 0, lockedUntil: '2026-10-03T17:30:00.000Z', redeemablePoints: 40 }),
    );
    expect(note).toContain('60 điểm từ đơn mới giao sẽ dùng được sau ngày 04/10/2026');
    expect(note).toContain('40');
  });

  it('điểm của đơn đang chờ xử lý đổi/trả → không hứa ngày cụ thể', () => {
    const note = lockedPointsNote(
      overview({ pointsBalance: 100, lockedPoints: 30, lockedReturnPoints: 30, lockedUntil: null, redeemablePoints: 70 }),
    )!;
    expect(note).toContain('30 điểm từ đơn đang chờ xử lý đổi/trả');
    expect(note).not.toMatch(/sau ngày/);
  });
});

describe('rewardButtonLabel', () => {
  const r = { pointsCost: 50, canRedeem: false };
  it('đổi được → "Đổi ngay"', () => {
    expect(rewardButtonLabel({ ...r, canRedeem: true }, { pointsBalance: 100 })).toBe('Đổi ngay');
  });
  it('số dư chưa đủ → "Cần X điểm"', () => {
    expect(rewardButtonLabel(r, { pointsBalance: 20 })).toBe('Cần 50 điểm');
  });
  it('số dư đủ nhưng điểm đang khoá (đơn mới giao) → không nói "Cần X điểm" sai sự thật', () => {
    expect(rewardButtonLabel(r, { pointsBalance: 100, redeemablePoints: 40 })).toBe('Chờ mở khoá điểm');
  });
});
