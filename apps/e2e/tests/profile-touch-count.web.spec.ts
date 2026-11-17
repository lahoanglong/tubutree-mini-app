import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web /tai-khoan (Cá nhân): số phần tử tương tác nhìn thấy trong vùng nội dung chính (`main`) ở hai màn đầu (mép trên < 2 × chiều cao khung nhìn).
 * Không tính đầu trang, chân trang, thanh tab dưới, cột trái AccountShell (nằm ngoài `main`) và liên kết lùi.
 * 390×844 giống Mini App: khách thường (đổi rác bật, chat bật, Trợ lý AI bật, huy hiệu tắt, mọi dòng mở tại chỗ đóng) ≤ 14.
 * 1440×900: phần Cá nhân (trừ khối "Đơn hàng của tôi" có ô tìm, chỉ có từ md) ≤ 14; in thêm tổng kể cả khối đó để ghi số đo.
 */

const me = (role: string) => ({
  id: `u-touch-${role}`, fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role, referralCode: 'AN123',
  onboarded: true, segments: [], pointsBalance: 1_250, pointsConvertedBalance: 0, walletBalance: 50_000,
});

function mockProfile(api: MockApi, role: string) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me(role) }));
  api.get('/me', () => me(role));
  api.get('/auth/me', () => ({ ...me(role), ownsBrand: false, hasDeskPoint: false }));
  api.get('/config/public', {
    aiAdvisorEnabled: true,
    chat: { enabled: true, hours: { start: '00:00', end: '23:59' } },
    waste: { enabled: true, dropoff: true, mailin: false, pickup: false },
  });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 1_250, pointsConvertedBalance: 0 });
  api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
  api.get('/me/referral', { referralCode: 'AN123', successCount: 0, earnedPoints: 0, minOrderAmount: 200_000, windowDays: 30, referrerRewardPoints: 5_000 });
  api.get('/me/support-chat/summary', { unreadCount: 0 });
  api.get('/dealer/me', { status: 'NONE', isDealer: false, tier: null, currentDebt: 0 });
  api.get('/game/badges', { enabled: false, badges: [] });
  api.get('/orders/status-counts', { pending_payment: 1, processing: 0, shipping: 2, delivered: 4, closed: 0 });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.allowUnmocked('GET /me/wallet', 'GET /me/subscriptions', 'GET /brand/owner/me', 'GET /me/notifications', 'POST /events');
}

/** Phần tử tương tác trong `main` của trang (bỏ liên kết lùi), không ẩn, mép trên trong hai màn đầu; `orders` = nằm trong khối đơn có ô tìm. */
function countTouches(page: Page) {
  return page.evaluate(() => {
    const SEL =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])';
    const h1 = Array.from(document.querySelectorAll('main h1')).find((h) => h.textContent?.trim() === 'Cá nhân');
    const root = h1?.closest('main') ?? document.body;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [inert], [aria-hidden="true"]');
    };
    const all = Array.from(root.querySelectorAll(SEL)).filter((el) => !el.closest('nav, [data-back-link]') && shown(el));
    const leaves = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    const limit = 2 * window.innerHeight;
    const rows = leaves
      .filter((el) => el.getBoundingClientRect().top + window.scrollY < limit)
      .map((el) => ({
        orders: !!el.closest('[data-testid="account-orders-section"]'),
        text: `${Math.round(el.getBoundingClientRect().top + window.scrollY)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)}`,
      }));
    return { profile: rows.filter((r) => !r.orders).map((r) => r.text), orders: rows.filter((r) => r.orders).map((r) => r.text) };
  });
}

async function openProfile(page: Page) {
  await page.goto('/tai-khoan');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Cá nhân', level: 1 })).toBeAttached({ timeout: 15_000 });
  await expect(main.getByRole('button', { name: /^Hỗ trợ/ })).toBeVisible({ timeout: 15_000 });
  // Chờ cấu hình (dòng Đổi rác), số mã (gợi ý Ưu đãi) và số đơn về hết: số đếm đo ở trạng thái cuối.
  await expect(main.getByRole('link', { name: /^Đổi rác lấy quà/ })).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText('1 mã giảm giá đang có')).toBeVisible({ timeout: 15_000 });
  await expect(main.getByRole('link', { name: 'Đang giao, 2 đơn' })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

const SIZES = [
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
];

test.describe('Web khách — Cá nhân: số điểm chạm hai màn đầu', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: không khôi phục được phiên, spec sẽ đỏ ở bước chờ trang
      }
    });
  });

  for (const size of SIZES) {
    test(`khách thường ${size.width}×${size.height}: ≤ 14 điểm chạm trong phần Cá nhân, không có dòng "Dành cho đối tác"`, async ({ page, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      await page.setViewportSize({ width: size.width, height: size.height });
      mockProfile(api, 'CUSTOMER');
      await openProfile(page);
      const main = page.getByRole('main');
      for (const name of [/^Mời bạn nhận quà/, /^Hỗ trợ/]) await expect(main.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
      await expect(main.getByRole('button', { name: /^Dành cho đối tác/ })).toHaveCount(0);
      const { profile, orders } = await countTouches(page);
      console.log(`PROFILE_TOUCH_WEB ${size.width}x${size.height} profile=${profile.length} ordersBlock=${orders.length} total=${profile.length + orders.length}\n${[...profile, '-- khối đơn --', ...orders].join('\n')}`);
      expect(profile.length, profile.join('\n')).toBeLessThanOrEqual(14);
      if (size.width < 768) expect(orders, 'khối đơn có ô tìm chỉ có từ md').toEqual([]);
    });
  }

  test('CTV 390×844: có đúng một dòng "Dành cho đối tác", đóng sẵn', async ({ page, api }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    await page.setViewportSize({ width: 390, height: 844 });
    mockProfile(api, 'AFFILIATE');
    await openProfile(page);
    const main = page.getByRole('main');
    const partner = main.getByRole('button', { name: /^Dành cho đối tác/ });
    await expect(partner).toHaveCount(1);
    await expect(partner).toHaveAttribute('aria-expanded', 'false');
    const { profile } = await countTouches(page);
    console.log(`PROFILE_TOUCH_WEB_PARTNER 390x844 ${profile.length}\n${profile.join('\n')}`);
    expect(profile.length, profile.join('\n')).toBeLessThanOrEqual(15);
    await partner.click();
    await expect(main.getByRole('link', { name: /^Cộng tác viên/ })).toHaveAttribute('href', '/ctv');
  });
});
