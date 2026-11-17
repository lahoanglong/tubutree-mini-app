import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { STATES, mockWorld, type OrderState } from './support/order-detail-states';

/**
 * Web /tai-khoan/don-hang/:code ở 390 (project "Web Customer Mobile") và 1440 ("Web Customer"): dòng thời gian dọc (cờ `orders.timeline_v2_enabled`,
 * API trả `timelineV2`), nút bật tin Zalo cho riêng đơn (cờ MSS, `orderZaloAvailable`), dòng mời sau khi giao và dòng tiến độ ở /tai-khoan
 * (cờ `referral.share_card_enabled`). Mọi lời gọi /api/** từ trình duyệt đi qua mock; riêng /moi/:code đọc cấu hình phía máy chủ từ API thật
 * của cổng (seed để cờ tắt) nên phải trả 404. Ảnh trước/sau khi có W204_SHOT_DIR.
 */
const SHIPPING = STATES.find((s) => s.key === 'shipping')!;
const DELIVERED = STATES.find((s) => s.key === 'delivered')!;
const HOUR = 3_600_000;
const ZALO_STATUS = { enabled: true, prechecked: false, choice: false, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
const CONFIG = { shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } };

let width = 0;
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer' && testInfo.project.name !== 'Web Customer Mobile', 'Chỉ hai project web khách');
  width = testInfo.project.name === 'Web Customer Mobile' ? 390 : 1440;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
});

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.W204_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function openOrder(api: MockApi, page: Page, state: OrderState, cfg: Record<string, unknown>, over: (now: number) => Record<string, unknown> = () => ({})) {
  const now = Date.now();
  const w = await mockWorld(api, page, 'web', state, now);
  Object.assign(w.order, over(now));
  api.get('/config/public', { ...CONFIG, waste: { enabled: false, dropoff: false, mailin: false, pickup: false }, ...cfg });
  api.get('/config/order-zalo', ZALO_STATUS);
  api.allowUnmocked('GET /waste/me');
  await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
  await state.ready(page);
  return w;
}

const V2 = (now: number) => ({
  timelineV2: true,
  trackingStaleHours: 72,
  orderZaloConsent: false,
  orderZaloAvailable: true,
  notices: [{ event: 'order.shipping', channel: 'ZALO', at: new Date(now - 16 * HOUR).toISOString() }],
});

test.describe('Web: hành trình đơn, nút Zalo, lời mời', () => {
  test('cờ tắt: thanh 4 bước và khối Hành trình như cũ, không có nút Zalo', async ({ page, api }) => {
    await openOrder(api, page, SHIPPING, {});
    await expect(page.getByTestId('order-timeline-tracker').filter({ visible: true })).toHaveCount(1);
    await expect(page.getByTestId('order-journey')).toHaveCount(0);
    await expect(page.locator('.order-timeline--journey')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Hành trình đơn hàng' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
    expect(api.callsTo('GET', '/config/order-zalo')).toHaveLength(0);
    await shot(page, `web-${width}-order-shipping-before`);
  });

  test('cờ bật, đang giao: một dòng thời gian dọc, 2 mốc hãng + Xem đủ, dòng đã báo qua Zalo; bật Zalo gửi POST rồi hiện số và lối sang Cài đặt', async ({ page, api }) => {
    const w = await openOrder(api, page, SHIPPING, { orderZaloEnabled: true, tubuZaloPhone: '0899149229' }, V2);
    const journey = page.getByTestId('order-journey');
    await expect(journey).toBeVisible();
    await expect(journey.getByRole('heading', { name: 'Hành trình đơn hàng' })).toBeVisible();
    const steps = journey.locator('li[data-step]');
    await expect(steps).toHaveCount(4);
    const tops = await steps.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(4);
    await expect(page.getByRole('list', { name: 'Hành trình đơn hàng' })).toHaveCount(0);
    const current = journey.locator('[aria-current="step"]');
    await expect(current).toContainText('Đang giao');
    await expect(current.getByText(/^Đã báo qua Zalo · \d{2}:\d{2} \d{2}\/\d{2}$/)).toBeVisible();
    await expect(current.getByRole('list', { name: 'Mốc vận chuyển' }).getByRole('listitem')).toHaveCount(2);
    const all = current.getByRole('button', { name: 'Xem đủ 5 mốc vận chuyển' });
    await expect(all).toBeVisible();
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('list', { name: 'Mốc vận chuyển' })).toHaveCount(1);

    const zalo = page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' });
    await expect(zalo).toHaveCount(1);
    await expect(page.getByText('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này. Số nhận: 090•••4567')).toBeVisible();
    expect((await zalo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noOverflow(page);
    await shot(page, `web-${width}-order-shipping-after`);

    await all.click();
    await expect(current.getByRole('list', { name: 'Mốc vận chuyển' }).getByRole('listitem')).toHaveCount(5);

    api.post('/orders/:code/order-zalo-consent', { orderZaloConsent: true });
    api.get('/orders/:code', ({ params }) => (params.code === w.order.code ? { ...w.order, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true } : { statusCode: 404 }));
    const posted = api.waitForCall('POST', '/orders/:code/order-zalo-consent');
    await zalo.click();
    expect((await posted).path).toBe(`/orders/${w.order.code}/order-zalo-consent`);
    const on = page.getByTestId('order-zalo-on');
    await expect(on).toContainText('Sẽ báo qua Zalo số 090•••4567');
    await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
    const settings = on.getByRole('link', { name: 'Tắt trong Cài đặt' });
    await expect(settings).toHaveAttribute('href', '/tai-khoan/cai-dat');
    expect((await settings.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noOverflow(page);
    await on.scrollIntoViewIfNeeded();
    await shot(page, `web-${width}-order-zalo-on-after`);
  });

  for (const key of ['confirmed', 'packed', 'shipping', 'delivered', 'cancelled'] as const) {
    test(`cờ bật, đơn ${key}: chỉ còn một dòng thời gian`, async ({ page, api }) => {
      const state = STATES.find((s) => s.key === key)!;
      await openOrder(api, page, state, {}, () => ({ timelineV2: true, trackingStaleHours: 72, notices: [] }));
      await expect(page.getByTestId('order-journey')).toBeVisible();
      await expect(page.locator('ol.order-timeline--journey').filter({ visible: true })).toHaveCount(1);
      await expect(page.getByRole('list', { name: 'Hành trình đơn hàng' })).toHaveCount(0);
      await noOverflow(page);
    });
  }

  test('cờ bật, đang giao quá 72 giờ không có mốc mới: dòng "Đang chờ hãng vận chuyển cập nhật"', async ({ page, api }) => {
    await openOrder(api, page, SHIPPING, {}, (now) => ({
      ...V2(now),
      orderZaloAvailable: false,
      notices: [],
      statusTimes: { CONFIRMED: new Date(now - 120 * HOUR).toISOString(), SHIPPING: new Date(now - 100 * HOUR).toISOString() },
      shippingHistory: [{ at: new Date(now - 90 * HOUR).toISOString(), status: 'picked', carrier: 'Giao Hàng Nhanh', code: 'GHN6789012345' }],
    }));
    const current = page.getByTestId('order-journey').locator('[aria-current="step"]');
    await expect(current.getByText('Đang chờ hãng vận chuyển cập nhật')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
    await shot(page, `web-${width}-order-stale-after`);
  });

  test('đã giao, thẻ giữ bao bì ẩn: cờ mời bật thì có đúng một liên kết "Mời bạn sống xanh" tới dòng mời ở Cá nhân', async ({ page, api }) => {
    await openOrder(api, page, DELIVERED, { referralShareCardEnabled: true }, (now) => ({ timelineV2: true, trackingStaleHours: 72, notices: [], deliveredAt: new Date(now - 26 * HOUR).toISOString() }));
    await expect(page.getByTestId('order-journey')).toBeVisible();
    await expect(page.getByText('Thích Tubu Tree?')).toBeVisible();
    const invite = page.getByRole('link', { name: 'Mời bạn sống xanh' });
    await expect(invite).toHaveCount(1);
    await expect(invite).toHaveAttribute('href', '/tai-khoan?section=referral');
    await noOverflow(page);
    await invite.scrollIntoViewIfNeeded();
    await shot(page, `web-${width}-order-delivered-after`);
  });

  test('đã giao, cờ mời tắt: không có dòng mời', async ({ page, api }) => {
    await openOrder(api, page, DELIVERED, {});
    await expect(page.getByRole('link', { name: 'Mời bạn sống xanh' })).toHaveCount(0);
    await expect(page.getByText('Thích Tubu Tree?')).toHaveCount(0);
    await shot(page, `web-${width}-order-delivered-before`);
  });
});

const me = { id: 'u-w204', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123', onboarded: true, segments: [], pointsBalance: 1_250, pointsConvertedBalance: 0, walletBalance: 0 };

function mockProfile(api: MockApi, cfg: Record<string, unknown>) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me }));
  api.get('/me', () => me);
  api.get('/auth/me', () => ({ ...me, ownsBrand: false, hasDeskPoint: false }));
  api.get('/config/public', { waste: { enabled: false, dropoff: false, mailin: false, pickup: false }, ...cfg });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 1_250, pointsConvertedBalance: 0 });
  api.get('/me/coupons', []);
  api.get('/me/referral', { referralCode: 'AN123', successCount: 1, earnedPoints: 5_000, invitedCount: 4, firstOrderCount: 2, minOrderAmount: 250_000, windowDays: 14, referrerRewardPoints: 5_000 });
  api.get('/me/support-chat/summary', { unreadCount: 0 });
  api.get('/dealer/me', { status: 'NONE', isDealer: false, tier: null, currentDebt: 0 });
  api.get('/game/badges', { enabled: false, badges: [] });
  api.get('/orders/status-counts', { pending_payment: 0, processing: 0, shipping: 0, delivered: 1, closed: 0 });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.allowUnmocked('GET /me/wallet', 'GET /me/subscriptions', 'GET /brand/owner/me', 'GET /me/notifications', 'POST /events');
}

test.describe('Web /tai-khoan: tiến độ mời', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: không khôi phục được phiên, ca sẽ đỏ ở bước chờ trang
      }
    });
  });

  test('cờ bật: một dòng tiến độ ba con số thay dòng thống kê cũ', async ({ page, api }) => {
    mockProfile(api, { referralShareCardEnabled: true });
    await page.goto('/tai-khoan?section=referral');
    const progress = page.getByTestId('invite-progress').filter({ visible: true });
    await expect(progress).toHaveText('4 bạn đã nhận mã · 2 bạn đã mua đơn đầu · 1 bạn đã đủ điều kiện, bạn nhận 5.000 Điểm Xanh', { timeout: 20_000 });
    await expect(page.getByText(/^Đã mời thành công/)).toHaveCount(0);
    await noOverflow(page);
    await progress.scrollIntoViewIfNeeded();
    await shot(page, `web-${width}-profile-invite-after`);
  });

  test('cờ tắt: không có dòng tiến độ', async ({ page, api }) => {
    mockProfile(api, {});
    await page.goto('/tai-khoan?section=referral');
    await expect(page.getByText('AN123', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('invite-progress')).toHaveCount(0);
    await shot(page, `web-${width}-profile-invite-before`);
  });
});

test('/moi/:code khi cờ referral.share_card_enabled tắt (mặc định seed): 404, không lộ mã', async ({ page }) => {
  const res = await page.goto('/moi/AN123');
  expect(res?.status()).toBe(404);
  expect(await page.content()).not.toContain('AN123</');
  await shot(page, `web-${width}-moi-flag-off`);
});
