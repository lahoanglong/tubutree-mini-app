import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { STATES, mockWorld, type OrderState } from './support/order-detail-states';

/**
 * Mini App ở 360 và 393px: dòng thời gian dọc của chi tiết đơn (cờ `orders.timeline_v2_enabled`, API trả `timelineV2`), nút bật tin Zalo cho
 * riêng đơn (cờ MSS, `orderZaloAvailable`), dòng mời bạn sau khi giao và dòng tiến độ mời ở /profile (cờ `referral.share_card_enabled`).
 * Cờ tắt thì màn giữ thanh 4 bước cũ, không có nút hay dòng mới. API mock toàn bộ. Ảnh trước/sau khi có W204_SHOT_DIR.
 */
const SHIPPING = STATES.find((s) => s.key === 'shipping')!;
const DELIVERED = STATES.find((s) => s.key === 'delivered')!;
const HOUR = 3_600_000;
const ZALO_STATUS = { enabled: true, prechecked: false, choice: false, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
const CONFIG = { shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } };

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.W204_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0);
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Liên kết giữa câu giãn vùng chạm bằng `::after` (`.tubu-hit-44`): chạm cách tâm 21px lên/xuống vẫn trúng nó. */
const reaches44 = (el: Locator) =>
  el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = (dy: number) => {
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + dy);
      return !!h && (h === node || node.contains(h));
    };
    return hit(-21) && hit(21);
  });

/** Đơn của trạng thái cộng các trường cờ bật trả về; `over` ghi đè từng ca. */
async function openOrder(api: MockApi, page: Page, state: OrderState, cfg: Record<string, unknown>, over: (now: number) => Record<string, unknown> = () => ({})) {
  const now = Date.now();
  const w = await mockWorld(api, page, 'miniapp', state, now);
  Object.assign(w.order, over(now));
  api.get('/config/public', publicConfig({ ...CONFIG, ...cfg }));
  api.get('/config/order-zalo', ZALO_STATUS);
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /waste/me');
  await page.goto(`/order/${w.order.code}`);
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

for (const width of [360, 393] as const) {
  test.describe(`Mini ${width}px: hành trình đơn và lời mời`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('cờ tắt: thanh 4 bước như cũ, không có hành trình dọc, nút Zalo hay dòng mời', async ({ page, api }) => {
      await openOrder(api, page, SHIPPING, {});
      await expect(page.getByTestId('order-timeline-tracker')).toBeVisible();
      await expect(page.getByTestId('order-journey')).toHaveCount(0);
      await expect(page.locator('.order-timeline--journey')).toHaveCount(0);
      await expect(page.getByRole('list', { name: 'Hành trình đơn hàng' })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
      expect(api.callsTo('GET', '/config/order-zalo')).toHaveLength(0);
      await shot(page, `mini-${width}-order-shipping-before`);
    });

    test('cờ bật, đang giao: một dòng thời gian dọc, mốc hãng gọn 2 dòng + Xem đủ, dòng đã báo qua Zalo, nút bật Zalo ≥44px', async ({ page, api }) => {
      const w = await openOrder(api, page, SHIPPING, { orderZaloEnabled: true, tubuZaloPhone: '0899149229' }, V2);
      const journey = page.getByTestId('order-journey');
      await expect(journey).toBeVisible();
      const steps = journey.locator('li[data-step]');
      await expect(steps).toHaveCount(4);
      const tops = await steps.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      expect(new Set(tops).size).toBe(4);
      const current = journey.locator('[aria-current="step"]');
      await expect(current).toContainText('Đang giao');
      await expect(current.getByText(/^Đã báo qua Zalo · \d{2}:\d{2} \d{2}\/\d{2}$/)).toBeVisible();
      await expect(current.getByText('Đang chờ hãng vận chuyển cập nhật')).toHaveCount(0);
      const all = current.getByRole('button', { name: 'Xem đủ 5 mốc vận chuyển' });
      await expect(all).toBeVisible();
      expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(journey.getByTestId('order-timeline-tracker')).toHaveCount(1);
      await expect(page.getByRole('list', { name: 'Mốc vận chuyển' })).toHaveCount(1);
      await expect(current.getByRole('list', { name: 'Mốc vận chuyển' }).getByRole('listitem')).toHaveCount(2);

      const zalo = page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' });
      await expect(zalo).toHaveCount(1);
      await expect(page.getByText('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này. Số nhận: 090•••4567')).toBeVisible();
      expect((await zalo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await noOverflow(page);
      await shot(page, `mini-${width}-order-shipping-after`);
      await zalo.scrollIntoViewIfNeeded();
      await shot(page, `mini-${width}-order-zalo-offer-after`);

      await all.click();
      await expect(current.getByRole('list', { name: 'Mốc vận chuyển' }).getByRole('listitem')).toHaveCount(5);
      await expect(current.getByTestId('track-events-toggle')).toHaveAttribute('aria-expanded', 'true');

      api.post('/orders/:code/order-zalo-consent', { orderZaloConsent: true });
      api.get('/orders/:code', ({ params }) => (params.code === w.order.code ? { ...w.order, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true } : { statusCode: 404 }));
      const posted = api.waitForCall('POST', '/orders/:code/order-zalo-consent');
      await zalo.click();
      expect((await posted).path).toBe(`/orders/${w.order.code}/order-zalo-consent`);
      await expect(page.getByTestId('order-zalo-on')).toContainText('Sẽ báo qua Zalo số 090•••4567');
      await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
      const settings = page.getByRole('button', { name: 'Tắt trong Cài đặt' });
      expect((await settings.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await noOverflow(page);
      await page.getByTestId('order-zalo-on').scrollIntoViewIfNeeded();
      await shot(page, `mini-${width}-order-zalo-on-after`);

      await expect
        .poll(() => api.callsTo('POST', '/events').flatMap((c) => (c.body as { events: { eventName: string }[] }).events.map((e) => e.eventName)), { timeout: 20_000 })
        .toEqual(expect.arrayContaining(['order_timeline_viewed', 'order_zalo_consent_from_detail']));
    });

    for (const key of ['confirmed', 'packed', 'shipping', 'delivered', 'cancelled'] as const) {
      test(`cờ bật, đơn ${key}: chỉ còn một dòng thời gian (không còn khối Hành trình 5 bước)`, async ({ page, api }) => {
        const state = STATES.find((s) => s.key === key)!;
        await openOrder(api, page, state, {}, () => ({ timelineV2: true, trackingStaleHours: 72, notices: [] }));
        await expect(page.getByTestId('order-journey')).toBeVisible();
        await expect(page.locator('ol.order-timeline--journey')).toHaveCount(1);
        await expect(page.getByRole('list', { name: 'Hành trình đơn hàng' })).toHaveCount(0);
        await expect(page.locator('[aria-current="step"]')).toHaveCount(key === 'cancelled' || key === 'delivered' ? 0 : 1);
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
      await expect(current.getByRole('button', { name: /Xem đủ/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toHaveCount(0);
      await shot(page, `mini-${width}-order-stale-after`);
    });

    test('đã giao, thẻ giữ bao bì ẩn: cờ mời bật thì có đúng một liên kết "Mời bạn sống xanh" tới dòng mời ở Cá nhân; cờ tắt thì không', async ({ page, api }) => {
      await openOrder(api, page, DELIVERED, { referralShareCardEnabled: true }, (now) => ({ timelineV2: true, trackingStaleHours: 72, notices: [], deliveredAt: new Date(now - 26 * HOUR).toISOString() }));
      await expect(page.getByTestId('order-journey')).toBeVisible();
      await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
      const invite = page.getByRole('button', { name: 'Mời bạn sống xanh' });
      await expect(invite).toHaveCount(1);
      await expect(page.getByText('Thích Tubu Tree?')).toBeVisible();
      await invite.scrollIntoViewIfNeeded();
      expect(await reaches44(invite)).toBe(true);
      await noOverflow(page);
      await shot(page, `mini-${width}-order-delivered-after`);
      await invite.click();
      await expect(page).toHaveURL(/\/profile\?section=referral/);
    });

    test('đã giao, cờ mời tắt: không có dòng mời', async ({ page, api }) => {
      await openOrder(api, page, DELIVERED, {});
      await expect(page.getByText(/Giao thành công/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mời bạn sống xanh' })).toHaveCount(0);
      await expect(page.getByText('Thích Tubu Tree?')).toHaveCount(0);
      await shot(page, `mini-${width}-order-delivered-before`);
    });
  });
}

const REFERRAL = {
  referralCode: 'BANBE77',
  successCount: 1,
  earnedPoints: 5000,
  invitedCount: 4,
  firstOrderCount: 2,
  milestones: [],
  nextMilestone: null,
  minOrderAmount: 250_000,
  windowDays: 14,
  referrerRewardPoints: 5000,
};

function mockProfile(api: MockApi, cfg: Record<string, unknown>) {
  mockSession(api, makeUser({ id: 'user-ref', referralCode: 'BANBE77' }));
  api.get('/config/public', publicConfig(cfg));
  api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
  api.get('/me/referral', REFERRAL);
  api.get('/auth/me', { ownsBrand: false });
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /affiliate/me', 'GET /me/coupons', 'GET /me/notifications', 'GET /notifications', 'GET /brand/owner/me', 'GET /dealer/me');
}

for (const width of [360, 393] as const) {
  test.describe(`Mini ${width}px: tiến độ mời ở Cá nhân`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('cờ bật: một dòng tiến độ ba con số thay dòng thống kê cũ', async ({ page, api }) => {
      mockProfile(api, { referralShareCardEnabled: true });
      await page.goto('/profile?section=referral');
      const progress = page.getByTestId('invite-progress');
      await expect(progress).toHaveText('4 bạn đã nhận mã · 2 bạn đã mua đơn đầu · 1 bạn đã đủ điều kiện, bạn nhận 5.000 Điểm Xanh', { timeout: 15_000 });
      await expect(page.getByText(/^Đã mời thành công/)).toHaveCount(0);
      await noOverflow(page);
      await shot(page, `mini-${width}-profile-invite-after`);
    });

    test('cờ tắt: dòng thống kê cũ, không có dòng tiến độ', async ({ page, api }) => {
      mockProfile(api, {});
      await page.goto('/profile?section=referral');
      await expect(page.getByText('BANBE77', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('invite-progress')).toHaveCount(0);
      await shot(page, `mini-${width}-profile-invite-before`);
    });
  });
}
