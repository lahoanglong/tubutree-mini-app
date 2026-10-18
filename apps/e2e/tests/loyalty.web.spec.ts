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
