import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkInView,
  getLoyaltyRewards,
  getMyRedemptions,
  lockedPointsNote,
  memberCardHint,
  pointsReasonLabel,
  redeemLoyaltyReward,
  rewardCardState,
  tierProgressPercent,
  type CheckInStatusResponse,
  type LoyaltyOverview,
  type MemberCardResponse,
} from './account-api';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api', () => ({ api: http }));

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
    ['LOYALTY_REDEEM_VOUCHER:reward-discount-50k', 'Đổi điểm lấy mã giảm giá'],
    ['ORDER_DELIVERED:TB123', 'Tích điểm từ đơn hàng'],
    ['ORDER_REDEEM:TB123', 'Dùng điểm khi thanh toán'],
    ['ORDER_REVERSED:TB123', 'Thu hồi điểm của đơn trả hàng'],
    ['ORDER_REFUND_POINTS:TB123', 'Hoàn lại điểm đã dùng'],
    ['POINTS_EXPIRED', 'Điểm hết hạn'],
    ['GAME_SPIN_WIN:p1', 'Phần thưởng Vườn Xanh'],
    ['SEASONPASS:s1:3:FREE', 'Phần thưởng Vườn Xanh'],
    ['REVIEW:ca-phe', 'Đánh giá sản phẩm'],
    // PD-3: xu đã gộp vào Điểm Xanh — mọi dòng sổ mới của lô quy đổi và nguồn thưởng cũ đều có nhãn riêng.
    ['XU_TO_POINTS:123456', 'Chuyển từ xu cũ sang Điểm Xanh'],
    ['ORDER_REDEEM_CONVERTED:TB123', 'Dùng điểm khi thanh toán'],
    ['ORDER_REFUND_CONVERTED:TB123', 'Hoàn điểm đơn huỷ/trả'],
    ['ORDER_REFUND_XU:TB123', 'Hoàn điểm đơn huỷ/trả'],
    ['REFERRAL_ORDER2:u1', 'Thưởng giới thiệu bạn bè'],
    ['REFERRAL_MILESTONE:u1:3', 'Thưởng giới thiệu bạn bè'],
    ['REFERRAL_ORDER2_REVOKE:u1', 'Thu hồi thưởng giới thiệu'],
    ['REFERRAL_MILESTONE_REVOKE:u1:3#1', 'Thu hồi thưởng giới thiệu'],
    ['COMMUNITY_POST:p1', 'Thưởng cộng đồng'],
    ['COMMUNITY_EVENT_WIN:e1:u1', 'Thưởng cộng đồng'],
    ['STOREFRONT_QUEST:PROFILE', 'Thưởng nhiệm vụ gian hàng'],
    ['CTV_MILESTONE:m1:2026-10', 'Thưởng mốc doanh số CTV'],
    ['GAME_BUY_TREE:TUBU-ABC', 'Góp quỹ trồng cây'],
    // R5-ADMIN-4: cùng bảng nhãn với màn quản trị (apps/web ledger-labels.ts) cho các mã API ghi mà trước đây rơi về nhãn chung hoặc nhãn sai.
    ['RETURN_REVERSED:TUBU2026101538731', 'Thu hồi điểm của đơn trả hàng'],
    ['RETURN_REFUND_POINTS:TUBU2026101538731', 'Hoàn lại điểm đã dùng (trả hàng)'],
    ['RETURN_REFUND_CONVERTED:TUBU2026101538731', 'Hoàn lại điểm đã dùng (trả hàng)'],
    ['GAME_SPIN_COST:p1', 'Quay vòng quay may mắn'],
    ['MISSION:m1:2026-10-15', 'Thưởng nhiệm vụ Vườn Xanh'],
    ['REVIEW_DELETE:r1', 'Thu hồi điểm đánh giá đã xoá'],
    ['REVIEW_RETURN:r1', 'Thu hồi điểm đánh giá (trả hàng)'],
    ['REFERRAL_ORDER2_DEBT:u1', 'Ghi nợ thu hồi thưởng giới thiệu'],
    ['REFERRAL_MILESTONE_DEBT:u1:3', 'Ghi nợ thu hồi thưởng giới thiệu'],
    ['MERGED:guest-1:ORDER_DELIVERED:TB123', 'Tích điểm từ đơn hàng'],
    ['RECYCLE:TR-8K2M9', 'Đổi rác lấy quà'],
    ['RECYCLE_REVERSED:TR-8K2M9', 'Thu hồi điểm đổi rác'],
    ['GIFT_REDEEM:gift-seed', 'Đổi điểm lấy quà'],
    ['GIFT_REFUND:QG-8K2M9P4T', 'Hoàn điểm quà'],
    ['PANCAKE_CHAT_ORDER:1234567', 'Tích điểm đơn đặt qua tư vấn viên'],
    ['PANCAKE_CHAT_ORDER_REVERSED:1234567', 'Thu hồi điểm đơn đặt qua tư vấn viên'],
    ['MARKETPLACE_ORDER:2610A1B2C3', 'Tích điểm đơn mua trên sàn'],
    ['MARKETPLACE_ORDER_REVERSED:2610A1B2C3', 'Thu hồi điểm đơn mua trên sàn'],
    ['MERGED:guest-1:PANCAKE_CHAT_ORDER:1234567', 'Tích điểm đơn đặt qua tư vấn viên'],
    ['MERGED:guest-1:RECYCLE:TR-8K2M9', 'Đổi rác lấy quà'],
    ['LOYALTY_REDEEM_VOUCHER:reward-freeship', 'Đổi điểm lấy mã giảm giá'],
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

  it('hạng có mốc chi tiêu → tính theo tiền mua 12 tháng (spent12m), không theo điểm', () => {
    const ov = overview({
      spent12m: 750_000,
      tierPoints: 99_999,
      nextTier: { id: 'loc', name: 'Lộc Biếc', minPoints: 500, minSpending: 1_500_000, pointsToGo: 0, spendingToGo: 750_000 },
    });
    expect(tierProgressPercent(ov)).toBe(50);
  });

  it('từ sàn chi tiêu hạng hiện tại → mốc hạng kế', () => {
    const ov = overview({
      spent12m: 11_000_000,
      tier: { id: 'loc', name: 'Lộc Biếc', multiplier: 1.2, perks: [] },
      nextTier: { id: 'dai', name: 'Đại Thụ', minPoints: 2000, minSpending: 20_000_000, pointsToGo: 0, spendingToGo: 9_000_000 },
      tiers: [
        { id: 'mam', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
        { id: 'loc', name: 'Lộc Biếc', minPoints: 500, minSpending: 1_500_000, multiplier: 1.2 },
        { id: 'dai', name: 'Đại Thụ', minPoints: 2000, minSpending: 20_000_000, multiplier: 1.5 },
      ],
    });
    expect(tierProgressPercent(ov)).toBe(51);
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

  it('số từ nghìn trở lên có dấu phân cách, cùng kiểu với số dư trên trang (C-083)', () => {
    const note = lockedPointsNote(
      overview({ pointsBalance: 5_000, lockedPoints: 1_250, lockedReturnPoints: 0, lockedUntil: '2026-10-03T17:30:00.000Z', redeemablePoints: 3_750 }),
    );
    expect(note).toContain('1.250 điểm từ đơn mới giao');
    expect(note).toContain('dùng được 3.750 điểm');
  });

  it('điểm của đơn đang chờ xử lý đổi/trả → không hứa ngày cụ thể', () => {
    const note = lockedPointsNote(
      overview({ pointsBalance: 100, lockedPoints: 30, lockedReturnPoints: 30, lockedUntil: null, redeemablePoints: 70 }),
    )!;
    expect(note).toContain('30 điểm từ đơn đang chờ xử lý đổi/trả');
    expect(note).not.toMatch(/sau ngày/);
  });
});

describe('rewardCardState (§4.8, §16.1: dùng số máy chủ trả)', () => {
  const c = { redeemablePoints: 14_000, pointsConvertedBalance: 40_000 };
  it.each([
    [{ kind: 'VOUCHER', pointsCost: 20_000, canRedeem: false, soldOut: true }, { kind: 'soldOut' }],
    [{ kind: 'VOUCHER', pointsCost: 10_000, canRedeem: true, soldOut: false }, { kind: 'redeem' }],
    [{ kind: 'VOUCHER', pointsCost: 20_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 6000 }],
    [{ kind: 'GIFT', pointsCost: 5_000_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 4_986_000 }],
    [{ kind: 'VOUCHER', pointsCost: 10_000, canRedeem: false, soldOut: false }, { kind: 'locked' }],
    [{ kind: 'TREE', pointsCost: 50_000, canRedeem: false, soldOut: false }, { kind: 'locked' }],
    [{ kind: 'TREE', pointsCost: 60_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 6000 }],
  ] as const)('%o → %o', (r, want) => { expect(rewardCardState(r, c)).toEqual(want); });
  it('đã hết thì không bao giờ tính "Cần thêm"', () => {
    expect(rewardCardState({ kind: 'SEED_PACK', pointsCost: 999_000, canRedeem: false, soldOut: true }, { redeemablePoints: 0, pointsConvertedBalance: 0 })).toEqual({ kind: 'soldOut' });
  });
});

describe('reward routes (§15.2)', () => {
  beforeEach(() => { http.get.mockReset().mockResolvedValue({ data: 'D' }); http.post.mockReset().mockResolvedValue({ data: 'D' }); });
  it('đổi quà gửi Idempotency-Key, id được mã hoá', async () => {
    await redeemLoyaltyReward('gift/1', 'key-1');
    expect(http.post).toHaveBeenCalledWith('/me/loyalty/rewards/gift%2F1/redeem', undefined, { headers: { 'Idempotency-Key': 'key-1' } });
  });
  it('quà của tôi và danh mục', async () => {
    await getMyRedemptions();
    await getLoyaltyRewards();
    expect(http.get.mock.calls.map((c) => c[0])).toEqual(['/me/loyalty/rewards/mine', '/me/loyalty/rewards']);
  });
});
