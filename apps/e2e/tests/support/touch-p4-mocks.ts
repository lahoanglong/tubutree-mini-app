import { makeUser, mockSession, type MockApi } from './mock-api';

/**
 * Mock dùng chung cho cổng W40A (touch-ergonomics-p4.*, touch-press-p4.*): Điểm Xanh, Sổ địa chỉ và Đánh giá có ảnh/video của Mini App.
 * Số liệu cố ý dài (12.450 điểm, 1.250.000đ) để chữ số phải đều và không tràn ở 320px.
 */

const REWARDS = [
  { id: 'reward-freeship', title: 'Voucher Miễn phí vận chuyển', pointsCost: 20, type: 'FREESHIP', value: 0, minOrder: 99_000 },
  { id: 'reward-discount-50k', title: 'Voucher Giảm 50.000đ', pointsCost: 50, type: 'AMOUNT', value: 50_000, minOrder: 300_000 },
  { id: 'reward-discount-100k', title: 'Voucher Giảm 100.000đ', pointsCost: 100, type: 'AMOUNT', value: 100_000, minOrder: 600_000 },
] as const;

const POINTS = 12_450;
const CHECKIN = [5, 5, 10, 10, 15, 15, 30];

/** Trang Điểm Xanh của khách đã đăng nhập: hạng, quà đổi được, điểm danh, lịch sử cộng/trừ điểm, một mã trong ví. */
export function mockLoyaltyScreen(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-loyal', fullName: 'Lê Thành Viên', referralCode: 'E2EREF', pointsBalance: POINTS }));
  api.post('/events', { accepted: 1 });
  api.get('/me/loyalty', {
    pointsBalance: POINTS,
    tierPoints: 60,
    tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: ['Tích điểm ×1 trên mọi đơn'] },
    nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 440 },
    tiers: [
      { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
      { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
    ],
  });
  api.get('/waste/requests', []);
  api.get('/me/coupons', [
    { code: 'LOYAL50K-E2E1', type: 'AMOUNT', value: 50_000, minOrder: 300_000, maxDiscount: null, endAt: new Date(Date.now() + 20 * 86_400_000).toISOString() },
  ]);
  api.get('/me/points/transactions', [
    { id: 'p1', delta: 1_250, reason: 'ORDER_DELIVERED:TB0001', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' },
    { id: 'p2', delta: -100, reason: 'REDEEM_REWARD', expiresAt: null, createdAt: '2026-10-12T05:00:00Z' },
    { id: 'p3', delta: 15, reason: 'DAILY_CHECK_IN', expiresAt: '2027-10-12T05:00:00Z', createdAt: '2026-10-13T05:00:00Z' },
  ]);
  api.get('/me/loyalty/rewards', {
    pointsBalance: POINTS,
    pointsConvertedBalance: 0,
    lockedPoints: 0,
    redeemablePoints: POINTS,
    giftClaimDays: 60,
    claimPoint: null,
    rewards: REWARDS.map((r, i) => ({
      id: r.id,
      kind: 'VOUCHER',
      name: r.title,
      description: `${r.title} cho đơn từ ${r.minOrder.toLocaleString('vi-VN')}đ`,
      label: null,
      pointsCost: r.pointsCost,
      imageUrl: null,
      stockRemaining: null,
      soldOut: false,
      canRedeem: true,
      claimInstructions: null,
      voucher: { type: r.type, value: r.value, minOrder: r.minOrder, maxDiscount: null, validDays: 30 },
      sortOrder: i + 1,
    })),
  });
  api.get('/me/loyalty/rewards/mine', []);
  api.get('/me/daily-check-in', {
    checkedInToday: false,
    streakDays: 2,
    currentCycleDay: 3,
    todayPoints: 10,
    rewards: CHECKIN.map((points, i) => ({ day: i + 1, points, claimed: i + 1 < 3, isToday: i + 1 === 3 })),
  });
  api.get('/me/loyalty/member-card', { memberCode: 'TUBUE2EREF', name: 'Lê', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: POINTS, posCreditEnabled: false });
}

const PROVINCES = [
  { code: '84_VN01', name: 'Hà Nội' },
  { code: '84_VN79', name: 'Thành phố Hồ Chí Minh' },
  { code: '84_VN48', name: 'Đà Nẵng' },
];
const WARDS = [
  { code: '84_VN79_26734', name: 'Phường Sài Gòn' },
  { code: '84_VN79_26735', name: 'Phường Bến Thành' },
];

/** Hai địa chỉ (một mặc định, một thường) và danh mục Tỉnh/Phường để mở tấm chọn. */
export function mockAddressBook(api: MockApi): void {
  mockSession(api, makeUser({ id: 'u-addr', fullName: 'Nguyễn Văn An' }));
  const base = { recipient: 'Nguyễn Văn An', phone: '0912345678', street: '12 Lê Lợi', province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Sài Gòn', wardCode: '84_VN79_26734' };
  api.get('/me/addresses', [
    { id: 'a1', ...base, isDefault: true },
    { id: 'a2', ...base, recipient: 'Trần Thị Bích Ngọc', street: '45/7 Nguyễn Huệ, khu phố 3', isDefault: false },
  ]);
  api.get('/geo/provinces', PROVINCES);
  api.get('/geo/communes', WARDS);
}

/** Năm đánh giá: có chữ, có ảnh, có video; tổng 4,9 sao từ 1.234 đánh giá để chữ số phải đều. */
export function mockReviewsWithMedia(api: MockApi): void {
  const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
    id, rating, comment: `Nhận xét ${id}`, images: [] as string[], videoUrl: null as string | null,
    createdAt: '2026-09-01T00:00:00.000Z', author: `Khách ${id}`, verifiedPurchase: true, ...extra,
  });
  const img = (n: number) => `https://res.cloudinary.com/tubu/image/upload/v1/r${n}.jpg`;
  api.get('/products/:slug/reviews', {
    average: 4.9, count: 1_234, videoCount: 1, distribution: { '5': 1_200, '4': 30, '1': 4 },
    items: [
      review('r1', 5),
      review('r2', 5, { images: [img(1), img(2), img(3)] }),
      review('r3', 4, { videoUrl: 'https://res.cloudinary.com/tubu/video/upload/v1/r3.mp4', images: [img(4)] }),
      review('r4', 1),
      review('r5', 5, { images: [img(5)] }),
    ],
    nextCursor: null,
  });
}

export const ELIGIBLE_TO_REVIEW = {
  canReview: true,
  reason: null,
  rewardAvailable: true,
  purchaseCount: 1,
  reviewableOrders: [{ orderId: 'ord-w40a', code: 'TUBU-W40A-RV', deliveredAt: '2026-10-20T08:00:00.000Z' }],
  myReviews: [],
};
