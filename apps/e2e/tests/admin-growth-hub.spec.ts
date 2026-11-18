import { test, expect, type MockApi } from './support/mock-api';
import { PURCHASE_FUNNEL_STEPS, type AdminGrowthOverviewDTO } from '@tubutree/shared-types';

/**
 * Admin — tab "Trung tâm tăng trưởng": phễu 7/30 ngày, công tắc game và kinh tế đơn hàng, banner. Mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB.
 * Mở thẳng `/admin?tab=growth`. Ảnh chụp ghi vào GROWTH_SHOTS (nếu có) để so bố cục 360/390/768/1440.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const TOTALS: Record<string, number> = { product_viewed: 1240, add_or_buy: 310, checkout_started: 120, place_order_click: 80, order_placed: 64 };
const overview = (days: 7 | 30): AdminGrowthOverviewDTO => {
  const start = days === 7 ? '2026-11-12' : '2026-10-20';
  return {
    generatedAt: '2026-11-18T08:00:00.000Z',
    days,
    sinceDay: start,
    funnel: {
      rows: PURCHASE_FUNNEL_STEPS.map((step) => ({ step, web: Math.round(TOTALS[step]! * 0.6), miniapp: TOTALS[step]! - Math.round(TOTALS[step]! * 0.6), total: TOTALS[step]! })),
      sessions: { web: 900, miniapp: 600, total: 1500 },
    },
    repeat: { newBuyers: 40, newBuyersWithSecond: 9, buyers: 58, returningBuyers: 18 },
    games: {
      players: 210,
      buyers: 37,
      byGame: [
        { game: 'match', players: 120, buyers: 20 },
        { game: 'origin', players: 70, buyers: 11 },
        { game: 'matcher', players: 40, buyers: 9 },
      ],
    },
    daily: Array.from({ length: days }, (_, i) => ({
      day: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10),
      orders: 4 + ((i * 7) % 11),
      players: 18 + ((i * 5) % 13),
    })),
  };
};

const CONFIG = [
  ['game.mini.enabled', true, 'game'],
  ['game.mini.match.enabled', true, 'game'],
  ['game.mini.origin.enabled', false, 'game'],
  ['game.matcher_enabled', true, 'game'],
  ['shipping.free_threshold', 150_000, 'shipping'],
  ['loyalty.max_redeem_pct', 0.2, 'loyalty'],
  ['loyalty.checkin_points', [10, 10, 10, 20, 20, 20, 50], 'loyalty'],
].map(([key, value, category]) => ({ key, value, description: null, category }));

const BANNERS = [
  { id: 'c1', slug: 'tuan-le-xanh', title: 'Tuần lễ sống xanh', status: 'live', isActive: true, placement: 'HOME_TOP', health: { blockers: 0, warnings: 0 } },
  { id: 'c2', slug: 'qua-tang', title: 'Quà dùng thử cho đơn từ 299.000đ', status: 'off', isActive: false, placement: 'OFFERS_TOP', health: { blockers: 1, warnings: 0 } },
].map((o) => ({
  subtitle: null,
  image: null,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-11-10T00:00:00.000Z',
  endAt: '2026-11-30T00:00:00.000Z',
  sortOrder: 0,
  productCount: 2,
  couponCount: 0,
  ...o,
}));

function mockAdmin(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', CONFIG);
  api.put('/admin/config', { ok: true });
  api.get('/admin/growth/overview', ({ call }) => overview(call.query.get('days') === '30' ? 30 : 7));
  api.get('/admin/campaigns', BANNERS);
}

test.describe('Admin — Trung tâm tăng trưởng', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdmin(api);
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('phễu đổi 7/30 ngày; công tắc game ghi đúng khoá; freeship khác mức chuẩn điền được 199.000đ', async ({ page, api }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin?tab=growth');

    await expect(page.getByText('Quay lại mua lần 2').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '30 ngày' }).click();
    await expect.poll(() => api.calls.some((c) => c.path === '/admin/growth/overview' && c.query.get('days') === '30')).toBe(true);

    await page.getByRole('switch', { name: 'Đoán Xuất Xứ' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Bật', exact: true }).click();
    await expect.poll(() => api.callsTo('PUT', '/admin/config').map((c) => c.body)).toContainEqual({ key: 'game.mini.origin.enabled', value: true });

    const free = page.locator('[data-growth-key="shipping.free_threshold"]');
    await expect(free).toContainText('Khác mức chuẩn');
    await free.getByRole('button', { name: /Điền mức chuẩn/ }).click();
    await free.getByRole('button', { name: 'Lưu' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect.poll(() => api.callsTo('PUT', '/admin/config').map((c) => c.body)).toContainEqual({ key: 'shipping.free_threshold', value: 199_000 });
  });

  for (const width of [360, 390, 768, 1440]) {
    test(`${width}px: không tràn ngang, đủ phễu, công tắc và banner`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin?tab=growth');
      await expect(page.getByText('Quay lại mua lần 2').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('switch', { name: 'Ghép Cặp' })).toBeVisible();
      await expect(page.getByText('Tuần lễ sống xanh')).toBeVisible();
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `tràn ngang ${over}px`).toBeLessThanOrEqual(1);
      if (process.env.GROWTH_SHOTS) await page.screenshot({ path: `${process.env.GROWTH_SHOTS}/growth-${width}.png`, fullPage: true });
    });
  }
});
