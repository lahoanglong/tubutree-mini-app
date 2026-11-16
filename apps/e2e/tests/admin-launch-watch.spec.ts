import { test, expect, type MockApi } from './support/mock-api';
import { RECYCLE_FUNNEL_STEPS, type LaunchWatchDTO, type LaunchWatchFraud } from '@tubutree/shared-types';

/**
 * Admin — tab "Theo dõi 72h sau launch": phễu Đổi rác, chống gian lận, tỉ lệ đơn thứ hai. Mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB.
 * Mở thẳng `/admin?tab=launchWatch`.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
}

const funnel = (enter: [number, number, number], submitted: [number, number, number]) => ({
  rows: RECYCLE_FUNNEL_STEPS.map((step) => {
    const [web, miniapp, total] = step === 'enter' ? enter : step === 'submitted' ? submitted : [0, 0, 0];
    return { step, web, miniapp, total };
  }),
  confirmedRequests: 3,
  confirmedUsers: 2,
});

const fraud = (over: Partial<LaunchWatchFraud> = {}): LaunchWatchFraud => ({
  unverifiedPhone: { totalRequests: 10, requests: 4, users: 2, pointsAwarded: 35 },
  zeroGift: { attached: 3, accounts: 2, maxPerAccount: 2, ordersOverOne: 0, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' },
  freeShipRecycle: { orders: 3, users: 2, totalOrders: 5, shareOfOrdersPct: 60, withConfirmedWaste: 2 },
  ...over,
});

const SNAPSHOT: LaunchWatchDTO = {
  generatedAt: '2026-11-16T07:05:00.000Z',
  windows: {
    h72: { funnel: funnel([6, 5, 8], [2, 2, 3]), fraud: fraud() },
    d7: { funnel: funnel([60, 50, 80], [20, 20, 40]), fraud: fraud({ zeroGift: { attached: 6, accounts: 2, maxPerAccount: 3, ordersOverOne: 1, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' } }) },
    d30: { funnel: funnel([600, 500, 1234], [200, 200, 400]), fraud: fraud() },
  },
  secondOrder: { windowDays: 14, matured: { customers: 8, withSecond: 3 }, pending: { customers: 5, withSecond: 2 } },
  webhookRejects: {
    thresholdPerHour: 10,
    sources: [
      { source: 'pancake', lastHour: 52, last24h: 600, peakPerHour: 52, lastAt: '2026-11-16T07:00:00.000Z', alert: true },
      { source: 'gomdon', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
    ],
  },
};

test.describe('Admin — Theo dõi 72h sau launch', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/config', []);
    api.get('/admin/analytics/launch-watch', SNAPSHOT);
  });

  test('mở tab: phễu, chống gian lận, đơn thứ hai; đổi cửa sổ sang 7 ngày thì hiện cảnh báo đỏ', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=launchWatch');

    await expect(page.getByRole('heading', { name: 'Phễu Đổi rác' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('group', { name: 'Quà 0đ gắn đơn' })).toContainText('Chỉ đếm đơn tạo từ');
    await expect(page.getByRole('heading', { name: /Khách đặt đơn thứ 2 trong 14 ngày/ })).toBeVisible();
    const giftAlerts = page.locator('[role="alert"]').filter({ hasText: 'quà 0đ' });
    await expect(giftAlerts).toHaveCount(0);

    const webhookAlerts = page.getByRole('region', { name: 'Cảnh báo webhook' });
    await expect(webhookAlerts).toContainText('Webhook Pancake đang bị từ chối');
    await expect(webhookAlerts).toContainText('52 lần trong 1 giờ qua (24 giờ: 600)');
    await expect(webhookAlerts).not.toContainText('Gomdon');

    await page.getByRole('button', { name: '7 ngày' }).click();
    await expect(giftAlerts).toContainText('1 đơn mang hơn 1 quà 0đ');
  });

  test('375px: không tràn ngang cả trang; bảng phễu cuộn trong khung riêng', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin?tab=launchWatch');
    await expect(page.getByRole('heading', { name: 'Phễu Đổi rác' })).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: process.env.W180_SHOT ?? 'test-results/launch-watch-375.png', fullPage: true });
  });
});
