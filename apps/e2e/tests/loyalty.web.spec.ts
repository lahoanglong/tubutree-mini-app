import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: Điểm Xanh và hạng thành viên (/tai-khoan/diem-xanh). Mọi lời gọi /api/** đi qua mock (fixture `api`).
 * Điểm danh phải gửi đúng POST /me/loyalty/check-in một lần dù bấm đúp; thẻ thành viên số mã hoá đúng memberCode.
 */

const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 1681, pointsConvertedBalance: 119, walletBalance: 0,
};
const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day === 7 ? 10 : day, claimed: day < 3, isToday: day === 3 }));

function mockLoyalty(api: MockApi, checkIn: { done: boolean }) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/me/loyalty', {
    pointsBalance: 1681, pointsConvertedBalance: 119,
    tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Quà sinh nhật'] },
    nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
    tiers: TIERS, spent12m: 1_500_000, tierPoints: 80,
    rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
  });
  api.get('/me/coupons', [{ code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' }]);
  api.get('/me/points/transactions', [{ id: 'p1', delta: 250, reason: 'ORDER_DELIVERED:TB0', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' }]);
  api.get('/me/loyalty/check-in', () => ({ checkedInToday: checkIn.done, streakDays: 2, currentCycleDay: 3, todayPoints: 3, rewards: REWARDS }));
  api.post('/me/loyalty/check-in', () => {
    checkIn.done = true;
    return { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1803, message: 'Điểm danh thành công +3 Điểm Xanh' };
  });
  api.get('/me/loyalty/member-card', {
    memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: 1681, posCreditEnabled: true,
  });
}

test.describe('Web khách: Điểm Xanh và hạng thành viên', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('thẻ hạng, mã giảm giá và lịch sử hiện đúng số từ API', async ({ page, api }) => {
    mockLoyalty(api, { done: false });
    await page.goto('/tai-khoan/diem-xanh');
    await expect(page.getByRole('heading', { name: 'Hạng thành viên & Điểm Xanh', level: 1 })).toBeVisible();
    await expect(page.getByText('1.800 điểm Xanh')).toBeVisible();
    await expect(page.getByText('trong đó 119 điểm không hết hạn')).toBeVisible();
    await expect(page.getByText('Còn 2,5 triệu mua hàng để lên hạng Lộc Biếc')).toBeVisible();
    await expect(page.getByText('Miễn phí vận chuyển')).toBeVisible();
    await expect(page.getByText('Tích điểm từ đơn hàng · TB0')).toBeVisible();
  });

  test('điểm danh: bấm đúp chỉ gửi một POST, báo kết quả và nút chuyển "Đã điểm danh"', async ({ page, api }) => {
    mockLoyalty(api, { done: false });
    await page.goto('/tai-khoan/diem-xanh');
    const button = page.getByRole('button', { name: 'Điểm danh +3' });
    await expect(button).toBeEnabled();
    await button.dblclick();
    await expect(page.getByText('Điểm danh thành công +3 Điểm Xanh')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã điểm danh' })).toBeDisabled();
    expect(api.callsTo('POST', '/me/loyalty/check-in')).toHaveLength(1);
  });

  test('thẻ thành viên số: hiện mã gõ tay được và lời nhắc, Đóng tắt thẻ', async ({ page, api }) => {
    mockLoyalty(api, { done: true });
    await page.goto('/tai-khoan/diem-xanh');
    await page.getByRole('button', { name: /Thẻ thành viên số/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Thẻ Thành Viên Tubu' });
    await expect(dialog.getByText('TUBUAN123')).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'QR' })).toBeVisible();
    await expect(dialog.getByText(/Đưa mã QR này cho thu ngân/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API điểm', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/tai-khoan/diem-xanh');
    await expect(page.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/me/loyalty')).toHaveLength(0);
  });
});

/**
 * Web khách: Ví Tubu (/tai-khoan/vi-tubu). Rút tiền phải gửi đúng POST /wallet/withdraw một lần dù bấm đúp,
 * kèm Idempotency-Key; sao kê tải thêm theo 20 dòng/trang.
 */
const WALLET_TXNS = [
  { id: 't1', delta: 50_000, balanceAfter: 1_250_000, type: 'CASHBACK', reason: null, orderId: null, createdAt: '2026-10-05T07:04:00Z' },
  { id: 't2', delta: -100_000, balanceAfter: 1_200_000, type: 'WITHDRAW', reason: 'Rút về ngân hàng', orderId: null, createdAt: '2026-10-04T10:00:00Z' },
  { id: 't3', delta: 10_000, balanceAfter: 1_300_000, type: 'ADJUST', reason: null, orderId: null, createdAt: '2026-10-03T10:00:00Z' },
];

function mockWallet(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/me/wallet', { walletBalance: 1_250_000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0, withdrawMin: 100_000, withdrawFee: 3_000 });
  api.get('/me/loyalty', { pointsBalance: 1681, pointsConvertedBalance: 119, tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: [] }, tiers: TIERS, rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 } });
  api.get('/me/referral', { referralCode: 'AN123', successCount: 2, earnedPoints: 20, milestones: [{ count: 5, bonusPoints: 50 }], nextMilestone: { count: 5, bonusPoints: 50 } });
  api.get('/me/wallet/transactions', ({ call }) => {
    const page = Number(call.query.get('page') ?? 1);
    return { data: page === 1 ? WALLET_TXNS.slice(0, 2) : WALLET_TXNS.slice(2), meta: { page, limit: 2, total: 3 } };
  });
  api.post('/wallet/withdraw', () => ({ ok: true, payoutId: 'p1', status: 'PENDING', withdrawn: 200_000, fee: 3_000, net: 197_000 }));
}

test.describe('Web khách: Ví Tubu', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('số dư, Điểm Xanh, mã giới thiệu và sao kê hiện đúng số từ API; Xem thêm nạp trang 2', async ({ page, api }) => {
    mockWallet(api);
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByRole('heading', { name: 'Ví Tubu', level: 1 })).toBeVisible();
    await expect(page.getByText('1.250.000đ').first()).toBeVisible();
    await expect(page.getByText('trong đó 119 điểm không hết hạn')).toBeVisible();
    await expect(page.getByText('AN123')).toBeVisible();
    await expect(page.getByText('Rút về ngân hàng', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xem thêm' }).click();
    await expect(page.getByText('Số dư 1.300.000đ')).toBeVisible();
  });

  test('rút tiền: nhập đủ thông tin, bấm đúp chỉ gửi một POST kèm Idempotency-Key và đúng body', async ({ page, api }) => {
    mockWallet(api);
    await page.goto('/tai-khoan/vi-tubu');
    await page.getByRole('button', { name: 'Rút tiền về ngân hàng' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rút tiền về ngân hàng' });
    await dialog.getByLabel('Số tiền rút').fill('200000');
    await dialog.getByLabel('Tên ngân hàng').fill('Techcombank');
    await dialog.getByLabel('Số tài khoản').fill('19031234567');
    await dialog.getByLabel('Chủ tài khoản').fill('LA HOANG LONG');
    await expect(dialog.getByText(/Thực nhận: 197\.000đ/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Rút 200.000đ' }).dblclick();
    await expect(page.getByText('Đã gửi yêu cầu rút. Thực nhận 197.000đ trong 1-3 ngày làm việc.')).toBeVisible();
    const posts = api.callsTo('POST', '/wallet/withdraw');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ amount: 200_000, bankInfo: { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'LA HOANG LONG' } });
    expect(posts[0]!.headers['idempotency-key']).toBeTruthy();
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API ví', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/tai-khoan/vi-tubu');
    await expect(page.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/me/wallet')).toHaveLength(0);
  });
});
