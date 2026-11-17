import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import type { AuthUser } from '@tubutree/shared-types';

/**
 * Zalo Mini App, Cá nhân: số phần tử tương tác nhìn thấy trong nội dung trang ở hai màn đầu (mép trên < 2 × chiều cao khung nhìn), không tính
 * thanh tab dưới. Khách thường (đổi rác bật, chat bật, Trợ lý AI bật, huy hiệu tắt, mọi dòng mở tại chỗ đóng): ≤ 14, tức 2 ô số dư + "Xem tất cả"
 * + 4 ô đơn + 7 dòng. Tài khoản có vai trò đối tác thêm đúng một dòng "Dành cho đối tác"; khách thường không có dòng này.
 */

const SIZES = [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
];

function mockProfile(api: MockApi, role: NonNullable<AuthUser['role']>) {
  const user = makeUser({ id: `u-touch-${role}`, fullName: 'Nguyễn Văn An', role, referralCode: 'AN123', pointsBalance: 1_250, walletBalance: 50_000 });
  mockSession(api, user);
  api.get('/config/public', {
    aiAdvisorEnabled: true,
    chat: { enabled: true, hours: { start: '00:00', end: '23:59' } },
    waste: { enabled: true, dropoff: true, mailin: false, pickup: false },
  });
  api.get('/auth/me', { ...user, ownsBrand: false, hasDeskPoint: false });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 1_250, pointsConvertedBalance: 0 });
  api.get('/me/wallet', { walletBalance: 50_000 });
  api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
  api.get('/me/referral', { referralCode: 'AN123', successCount: 0, earnedPoints: 0, minOrderAmount: 200_000, windowDays: 30, referrerRewardPoints: 5_000 });
  api.get('/me/support-chat/summary', { unreadCount: 0 });
  api.get('/dealer/me', { status: 'NONE', isDealer: false, tier: null, currentDebt: 0 });
  api.get('/game/badges', { enabled: false, badges: [] });
  api.get('/orders/status-counts', { pending_payment: 1, processing: 0, shipping: 2, delivered: 4, closed: 0 });
  api.allowUnmocked('POST /events', 'GET /me/notifications');
}

/** Phần tử tương tác trong trang Cá nhân (khung `.zaui-page` có h1 "Cá nhân"), bỏ thanh tab (`nav`), phần tử ẩn và phần tử nằm dưới hai màn đầu. */
function countTouches(page: Page) {
  return page.evaluate(() => {
    const SEL =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])';
    const h1 = Array.from(document.querySelectorAll('h1')).find((h) => h.textContent?.trim() === 'Cá nhân');
    const root = h1?.closest('.zaui-page') ?? document.body;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [inert], [aria-hidden="true"]');
    };
    const all = Array.from(root.querySelectorAll(SEL)).filter((el) => !el.closest('nav') && shown(el));
    // Khung bọc có tabindex chứa cả trang không phải một điểm chạm: chỉ tính phần tử trong cùng.
    const leaves = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    const limit = 2 * window.innerHeight;
    return leaves
      .filter((el) => el.getBoundingClientRect().top < limit)
      .map((el) => `${Math.round(el.getBoundingClientRect().top)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)}`);
  });
}

async function openProfile(page: Page) {
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: /^Cài đặt/ })).toBeVisible({ timeout: 15_000 });
  // Chờ cấu hình (dòng Đổi rác), số mã (gợi ý Ưu đãi) và số đơn về hết: số đếm đo ở trạng thái cuối.
  await expect(page.getByRole('button', { name: /^Đổi rác lấy quà/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 mã giảm giá đang có')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Đang giao, 2 đơn' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

test.describe('Zalo Mini App E2E — Cá nhân: số điểm chạm hai màn đầu', () => {
  for (const size of SIZES) {
    test(`khách thường ${size.width}×${size.height}: ≤ 14 điểm chạm, không có dòng "Dành cho đối tác"`, async ({ page, api }) => {
      await page.setViewportSize(size);
      mockProfile(api, 'CUSTOMER');
      await openProfile(page);
      for (const name of [/^Mời bạn nhận quà/, /^Hỗ trợ/]) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('button', { name: /^Dành cho đối tác/ })).toHaveCount(0);
      const touches = await countTouches(page);
      console.log(`PROFILE_TOUCH_MINI ${size.width}x${size.height} ${touches.length}\n${touches.join('\n')}`);
      expect(touches.length, touches.join('\n')).toBeLessThanOrEqual(14);
    });
  }

  test('CTV 360×640: có đúng một dòng "Dành cho đối tác", đóng sẵn, thêm một điểm chạm', async ({ page, api }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    mockProfile(api, 'AFFILIATE');
    await openProfile(page);
    const partner = page.getByRole('button', { name: /^Dành cho đối tác/ });
    await expect(partner).toHaveCount(1);
    await expect(partner).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /^Cộng tác viên/ })).toHaveCount(0);
    const touches = await countTouches(page);
    console.log(`PROFILE_TOUCH_MINI_PARTNER 360x640 ${touches.length}\n${touches.join('\n')}`);
    expect(touches.length, touches.join('\n')).toBeLessThanOrEqual(15);
    await partner.click();
    await expect(partner).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: /^Cộng tác viên/ })).toBeVisible();
  });
});
