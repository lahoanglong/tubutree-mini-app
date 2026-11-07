import type { Page } from '@playwright/test';
import { makeUser, mockSession, type MockApi } from './mock-api';
import { CTV_MILESTONES, CTV_TIERS, CTV_DASHBOARD, CTV_TAX_STATEMENT_EMPTY } from './affiliate-mocks';
import { COLLECTABLE, WALLET, HISTORY } from './voucher-mocks';

/**
 * Mock của web cho cổng W40A (touch-ergonomics-p4.web.spec.ts): cùng số liệu dài với Mini (touch-p4-mocks.ts) để so hai app một thước.
 * Web khôi phục phiên bằng POST /auth/refresh nên `mockSession` của Mini App (đăng nhập thẳng) không dùng được: ở đây dựng lại phiên cho web.
 */
export const POINTS = 12_450;
export const WALLET_VND = 1_250_000;

export async function webSignIn(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  const user = mockSession(api, makeUser({ id: 'u-p4', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', pointsBalance: POINTS, walletBalance: WALLET_VND }));
  // Web đọc điểm và ví từ GET /me (mockSession chỉ trả hồ sơ rút gọn cho Mini App).
  api.get('/me', () => ({ ...user, email: null, dob: null, avatarUrl: null, onboarded: true, segments: [] }));
  api.get('/config/public', { freeshipThreshold: 500_000, aiAdvisorEnabled: false, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/me/wishlist/ids', []);
}

export function mockWebProfile(api: MockApi): void {
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: POINTS, pointsConvertedBalance: 0 });
  api.get('/me/wallet', { walletBalance: WALLET_VND });
  api.get('/me/coupons', [{ id: 'c1', code: 'A' }, { id: 'c2', code: 'B' }]);
  api.get('/me/notifications', []);
  api.get('/auth/me', () => ({ id: 'u-p4', fullName: 'Nguyễn Văn An', ownsBrand: false }));
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.allowUnmocked('GET /me/referral', 'GET /me/summary', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary', 'POST /events');
}

export function mockWebLoyalty(api: MockApi): void {
  api.get('/me/loyalty', {
    pointsBalance: POINTS,
    pointsConvertedBalance: 0,
    tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Quà sinh nhật'] },
    nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
    tiers: [
      { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
      { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
    ],
    spent12m: 1_500_000,
    tierPoints: 80,
    rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
  });
  api.get('/waste/requests', []);
  api.get('/me/coupons', [{ code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199_000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' }]);
  api.get('/me/points/transactions', [
    { id: 'p1', delta: 1_250, reason: 'ORDER_DELIVERED:TB0001', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' },
    { id: 'p2', delta: -100, reason: 'REDEEM_REWARD', expiresAt: null, createdAt: '2026-10-12T05:00:00Z' },
    { id: 'p3', delta: 15, reason: 'DAILY_CHECK_IN', expiresAt: '2027-10-12T05:00:00Z', createdAt: '2026-10-13T05:00:00Z' },
  ]);
  api.get('/me/daily-check-in', {
    checkedInToday: false,
    streakDays: 2,
    currentCycleDay: 3,
    todayPoints: 10,
    todayWater: 10,
    rewards: [5, 5, 10, 10, 15, 15, 30].map((points, i) => ({ day: i + 1, points, claimed: i + 1 < 3, isToday: i + 1 === 3 })),
  });
  api.get('/me/loyalty/member-card', { memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: POINTS, posCreditEnabled: true });
  api.allowUnmocked('GET /me/loyalty/rewards', 'GET /me/loyalty/rewards/mine', 'POST /events');
}

export function mockWebVouchers(api: MockApi): void {
  api.get('/coupons/collectable', COLLECTABLE);
  api.get('/coupons/collectable/mine', { claimed: [], newCustomerOnly: [] });
  api.get('/me/coupons', WALLET);
  api.get('/me/coupons/history', HISTORY);
  api.allowUnmocked('POST /events');
}

export function mockWebAddressBook(api: MockApi): void {
  const base = { recipient: 'Nguyễn Văn An', phone: '0912345678', street: '12 Lê Lợi', province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Sài Gòn', wardCode: '84_VN79_26734' };
  api.get('/me/addresses', [
    { id: 'a1', ...base, isDefault: true },
    { id: 'a2', ...base, recipient: 'Trần Thị Bích Ngọc', street: '45/7 Nguyễn Huệ, khu phố 3', isDefault: false },
  ]);
  api.get('/geo/provinces', [
    { code: '84_VN01', name: 'Hà Nội' },
    { code: '84_VN79', name: 'Thành phố Hồ Chí Minh' },
    { code: '84_VN48', name: 'Đà Nẵng' },
  ]);
  api.get('/geo/communes', [
    { code: '84_VN79_26734', name: 'Phường Sài Gòn' },
    { code: '84_VN79_26735', name: 'Phường Bến Thành' },
  ]);
  api.allowUnmocked('POST /events');
}

export function mockWebAffiliate(api: MockApi): void {
  api.get('/affiliate/me', { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
  api.get('/affiliate/dashboard', { ...CTV_DASHBOARD, withdrawingCommission: 0 });
  api.get('/affiliate/tiers', CTV_TIERS);
  api.get('/affiliate/milestones', CTV_MILESTONES);
  api.get('/affiliate/analytics/storefronts', { storefronts: [] });
  api.get('/affiliate/analytics/products', []);
  api.get('/storefront/me/products', []);
  api.get('/academy/courses', []);
  api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 120_000, commissionPending: 60_000 });
  api.get('/affiliate/links', [{ id: 'l1', targetType: 'HOMEPAGE', shortCode: 'abc123', clicks: 42, createdAt: '2026-10-01T03:00:00Z' }]);
  api.get('/affiliate/commissions', [
    { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 1_500_000, rate: '0.1', amount: 150_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
  ]);
  api.get('/affiliate/payouts', []);
  api.get('/affiliate/tax-statement', CTV_TAX_STATEMENT_EMPTY);
  api.allowUnmocked('POST /events');
}
