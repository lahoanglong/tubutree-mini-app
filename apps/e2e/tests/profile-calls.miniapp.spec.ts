import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App: số lời gọi API khi mở Cá nhân với khách thường (CUSTOMER). Đếm mọi request tới /api từ trình duyệt (kể cả lời gọi lạ chưa mock).
 * Số đơn theo tab, số đơn đang xử lý của thanh đáy và số tin chưa đọc là MỘT lời gọi /me/summary (không còn status-counts, active-count,
 * unread-count), không tải danh sách đơn/tin chỉ để đếm, và khách thường không bị hỏi điểm quầy.
 */

const seen = (page: import('@playwright/test').Page) => {
  const out: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) out.push(`${r.method()} ${u.pathname.replace(/^\/api/, '')}${u.search}`);
  });
  return out;
};
const count = (calls: string[], re: RegExp) => calls.filter((c) => re.test(c)).length;

test.describe('Zalo Mini App E2E — số lời gọi API của Cá nhân', () => {
  test('khách thường: MỘT lời gọi /me/summary cho đơn, đơn đang xử lý và tin, không hỏi điểm quầy', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-count', fullName: 'Nguyễn Văn An' }));
    api.get('/me/notifications', []);
    api.get('/me/summary', { orders: { pending_payment: 2, processing: 1, shipping: 0, delivered: 5, closed: 0, active: 3 }, unreadNotifications: 73, activeSubscriptions: 0 });
    api.allowUnmocked('GET /me/wallet', 'GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /me/coupons', 'GET /me/loyalty', 'GET /brand/owner/me', 'GET /me/subscriptions', 'GET /chat/summary');
    const calls = seen(page);
    await page.goto('/profile');
    await expect(page.getByText('Nguyễn Văn An').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    console.log(`PROFILE_CALLS_MINI ${calls.length}\n${calls.join('\n')}`);

    expect(count(calls, /^GET \/me\/summary/)).toBe(1);
    expect(count(calls, /^GET \/orders\/status-counts/)).toBe(0);
    expect(count(calls, /^GET \/orders\/active-count/)).toBe(0);
    expect(count(calls, /^GET \/orders\?/)).toBe(0);
    expect(count(calls, /^GET \/me\/notifications\/unread-count/)).toBe(0);
    // Cùng một nguồn: số trên thanh đáy (đơn đang xử lý) và số ở Cá nhân đều đọc từ lời gọi đó.
    await expect(page.getByRole('navigation').getByRole('button', { name: /Cá nhân/ })).toHaveAccessibleName(/3 đơn/);
    expect(count(calls, /^GET \/me\/notifications(\?|$)/)).toBe(0);
    expect(count(calls, /^GET \/waste\/desk\/points/)).toBe(0);
  });
});
