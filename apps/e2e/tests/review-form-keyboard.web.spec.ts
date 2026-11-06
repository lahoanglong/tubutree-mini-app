import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, reply, test, type MockApi } from './support/mock-api';
import { firstProduct, type PdpProduct } from './support/pdp-product';

/**
 * Web khách: form viết đánh giá ở trang sản phẩm dùng được bằng bàn phím, ở 320/375px không tràn ngang (W27), cùng luật với Mini App.
 * Phần server của Next gọi API thật (sản phẩm có sẵn trong DB e2e), mọi lời gọi từ trình duyệt đi qua API giả.
 */
const ELIG = {
  canReview: true,
  reason: null,
  rewardAvailable: true,
  purchaseCount: 1,
  reviewableOrders: [{ orderId: 'ord-w27', code: 'TUBU-W27-RV', deliveredAt: '2026-10-20T08:00:00.000Z' }],
  myReviews: [],
};
const SAVED = { id: 'rv-w27', updated: false, pointsEarned: 0 };
const API_ERROR = 'Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.';

function mockPdp(api: MockApi, p: PdpProduct) {
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get('/me/wishlist/ids', []);
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [], nextCursor: null });
  api.get(`/products/${p.slug}/reviews/can-review`, ELIG);
  api.allowUnmocked('GET /me/coupons', 'GET /affiliate/me', 'GET /cart', 'POST /events', 'POST /affiliate/touch');
}

async function openForm(page: Page, api: MockApi, slug: string) {
  await page.goto(`/san-pham/${slug}`);
  // Chưa đăng nhập xong thì "Viết đánh giá" mở cổng đăng nhập: chỉ bấm khi can-review đã về.
  await expect.poll(() => api.callsTo('GET', `/products/${slug}/reviews/can-review`).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const section = page.locator('[data-section="pdp-reviews"]');
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('button', { name: 'Viết đánh giá' }).first().click();
  const form = page.getByRole('form', { name: 'Viết đánh giá' });
  await expect(form).toBeVisible();
  return form;
}

/** Bắn keydown Enter như bộ gõ đang chốt chữ; trả true khi trang chặn mặc định. */
const imeEnterBlocked = (page: Page, selector: string, init: { isComposing?: boolean; keyCode?: number }) =>
  page.evaluate(
    ({ selector, init }) => {
      const el = document.querySelector(selector)!;
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: init.isComposing === true });
      if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    { selector, init },
  );

test.describe('Web khách: form đánh giá bằng bàn phím (W27)', () => {
  let product: PdpProduct | null = null;
  test.beforeEach(async ({ page, request }) => {
    product ??= await firstProduct(request);
    test.skip(!product, 'DB e2e chưa có sản phẩm nào');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  for (const width of [320, 375]) {
    test(`${width}px: không tràn ngang; mũi tên, Home, End đổi sao và đi vòng; Enter bộ gõ bị chặn; Ctrl+Enter gửi một lần`, async ({ page, api }) => {
      mockPdp(api, product!);
      api.post(`/products/${product!.slug}/reviews`, SAVED);
      await page.setViewportSize({ width, height: 800 });
      const form = await openForm(page, api, product!.slug);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const formBox = await form.boundingBox();
      expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(width);

      const star = (n: number) => form.getByRole('radio', { name: `${n} sao` });
      await star(5).focus();
      await page.keyboard.press('ArrowLeft');
      await expect(star(4)).toHaveAttribute('aria-checked', 'true');
      await expect(star(4)).toBeFocused();
      await page.keyboard.press('Home');
      await expect(star(1)).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(star(5)).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('ArrowRight');
      await expect(star(1)).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowUp');
      await expect(star(4)).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      await expect(star(4)).toHaveAttribute('aria-checked', 'true');

      expect(await imeEnterBlocked(page, 'form[aria-label="Viết đánh giá"] [role="radio"][aria-label="4 sao"]', { keyCode: 229 })).toBe(true);
      expect(await imeEnterBlocked(page, 'form[aria-label="Viết đánh giá"] button[type="submit"]', { isComposing: true })).toBe(true);
      expect(await imeEnterBlocked(page, 'form[aria-label="Viết đánh giá"] textarea', { isComposing: true })).toBe(false);
      expect(api.callsTo('POST', `/products/${product!.slug}/reviews`)).toHaveLength(0);

      const box = form.locator('textarea');
      await box.fill('Dùng êm tay');
      const posted = api.waitForCall('POST', `/products/${product!.slug}/reviews`);
      await box.press('Control+Enter');
      expect((await posted).body).toMatchObject({ rating: 4, comment: 'Dùng êm tay', orderId: 'ord-w27' });
      await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
      expect(api.callsTo('POST', `/products/${product!.slug}/reviews`)).toHaveLength(1);
    });
  }

  test('bấm Gửi hai lần cùng nhịp rồi Ctrl+Enter khi máy chủ chưa trả lời: chỉ một lần gửi', async ({ page, api }) => {
    mockPdp(api, product!);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.post(`/products/${product!.slug}/reviews`, async () => {
      await gate;
      return SAVED;
    });
    await page.setViewportSize({ width: 375, height: 800 });
    const form = await openForm(page, api, product!.slug);
    await form.getByRole('button', { name: 'Gửi đánh giá' }).evaluate((b: HTMLElement) => {
      b.click();
      b.click();
    });
    await form.locator('textarea').press('Control+Enter');
    await page.waitForTimeout(400);
    release();
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', `/products/${product!.slug}/reviews`)).toHaveLength(1);
  });

  test('lỗi máy chủ: câu lỗi role=alert hiện trong form và được focus; gửi lại được', async ({ page, api }) => {
    mockPdp(api, product!);
    let fail = true;
    api.post(`/products/${product!.slug}/reviews`, () => (fail ? reply(400, { statusCode: 400, message: API_ERROR }) : SAVED));
    await page.setViewportSize({ width: 375, height: 800 });
    const form = await openForm(page, api, product!.slug);
    await form.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const alert = form.getByRole('alert').filter({ hasText: API_ERROR });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    fail = false;
    await form.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', `/products/${product!.slug}/reviews`)).toHaveLength(2);
  });
});
