import type { Page } from '@playwright/test';
import { test, expect, reply, type MockApi } from './support/mock-api';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';

/**
 * Zalo Mini App E2E: sheet viết đánh giá dùng được bằng bàn phím, ở 320/375px không tràn ngang (W27).
 * Hàng sao theo mẫu radio group (mũi tên, Home, End, đi vòng), Enter của bộ gõ tiếng Việt không bấm nút,
 * Ctrl+Enter trong ô nhận xét gửi, bấm đúp chỉ gửi một lần, lỗi máy chủ hiện role=alert và được focus.
 */
const ELIG = {
  canReview: true,
  reason: null,
  rewardAvailable: true,
  purchaseCount: 1,
  reviewableOrders: [{ orderId: 'ord-w27', code: 'TUBU-W27-RV', deliveredAt: '2026-10-20T08:00:00.000Z' }],
  myReviews: [],
};
const SAVED = { id: 'rv-w27', rating: 5, comment: null, images: [], videoUrl: null, isVisible: true, pointsEarned: 0, updated: false };
const API_ERROR = 'Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.';

const openSheet = async (page: Page, api: MockApi) => {
  await page.goto(`/product/${PILOT_SLUG}`);
  // Chưa đăng nhập xong thì "Viết đánh giá" là nút đăng nhập: chỉ bấm khi can-review đã về.
  await expect.poll(() => api.callsTo('GET', '/products/:slug/reviews/can-review').length, { timeout: 15_000 }).toBeGreaterThan(0);
  const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
  await reviews.getByRole('button', { name: 'Viết đánh giá' }).click({ timeout: 15_000 });
  const stars = page.getByRole('radiogroup', { name: 'Số sao' });
  await expect(stars).toBeVisible();
  return stars;
};
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

test.describe('Mini App: sheet đánh giá bằng bàn phím (W27)', () => {
  test.beforeEach(({ api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug/reviews/can-review', ELIG);
  });

  for (const width of [320, 375]) {
    test(`${width}px: không tràn ngang; mũi tên, Home, End đổi sao và đi vòng; Enter bộ gõ bị chặn; Ctrl+Enter gửi một lần`, async ({ page, api }) => {
      api.post('/products/:slug/reviews', SAVED);
      await page.setViewportSize({ width, height: 760 });
      const stars = await openSheet(page, api);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const starsBox = await stars.boundingBox();
      expect(starsBox!.x + starsBox!.width).toBeLessThanOrEqual(width);

      const star = (n: number) => stars.getByRole('radio', { name: `${n} sao` });
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

      expect(await imeEnterBlocked(page, '[role="radio"][aria-label="4 sao"]', { keyCode: 229 })).toBe(true);
      expect(await imeEnterBlocked(page, 'textarea[aria-label="Nội dung đánh giá"]', { isComposing: true })).toBe(false);
      expect(api.callsTo('POST', '/products/:slug/reviews')).toHaveLength(0);

      const box = page.getByLabel('Nội dung đánh giá');
      await box.fill('Dùng êm tay');
      const posted = api.waitForCall('POST', '/products/:slug/reviews');
      await box.press('Control+Enter');
      expect((await posted).body).toMatchObject({ rating: 4, comment: 'Dùng êm tay', orderId: 'ord-w27' });
      await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
      expect(api.callsTo('POST', '/products/:slug/reviews')).toHaveLength(1);
    });
  }

  test('bấm Gửi hai lần cùng nhịp rồi Ctrl+Enter khi máy chủ chưa trả lời: chỉ một lần gửi', async ({ page, api }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.post('/products/:slug/reviews', async () => {
      await gate;
      return SAVED;
    });
    await page.setViewportSize({ width: 375, height: 760 });
    await openSheet(page, api);
    await page.getByRole('button', { name: 'Gửi đánh giá' }).evaluate((b: HTMLElement) => {
      b.click();
      b.click();
    });
    await page.getByLabel('Nội dung đánh giá').press('Control+Enter');
    await page.waitForTimeout(400);
    release();
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', '/products/:slug/reviews')).toHaveLength(1);
  });

  test('lỗi máy chủ: câu lỗi role=alert hiện trong sheet và được focus; gửi lại được', async ({ page, api }) => {
    let fail = true;
    api.post('/products/:slug/reviews', () => (fail ? reply(400, { statusCode: 400, message: API_ERROR }) : SAVED));
    await page.setViewportSize({ width: 375, height: 760 });
    await openSheet(page, api);
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const alert = page.getByRole('alert').filter({ hasText: API_ERROR });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    fail = false;
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', '/products/:slug/reviews')).toHaveLength(2);
  });
});
