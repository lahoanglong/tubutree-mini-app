import { test, expect } from './support/mock-api';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';
import { probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';

/**
 * W42B, Mini App: bấm ảnh/video đánh giá ở trang sản phẩm mở lightbox toàn màn hình (ReviewMediaLightbox): bộ đếm "n / N" số đều, nút Trước/Sau ≥ 44px,
 * vuốt ngang, nút back của Zalo đóng lightbox thay vì thoát trang, "Thêm vào giỏ" ở chân. Mở 220ms theo đường cong drawer, giảm chuyển động thì hiện ngay.
 * Chạy ở 320 / 360 / 375 / 393px: vùng chạm thật ≥ 44px, không tràn ngang. Toàn bộ API được mock.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const REVIEW = {
  id: 'r1',
  rating: 4,
  comment: 'Rất thơm, giao nhanh, đóng gói kỹ.',
  images: [`${PNG}#a`, `${PNG}#b`],
  videoUrl: 'https://res.cloudinary.com/tubu/video/upload/v1/r1.mp4',
  createdAt: '2026-09-01T00:00:00.000Z',
  author: 'Lan',
  verifiedPurchase: true,
};
const WIDTHS = [320, 360, 375, 393] as const;

test.describe('Zalo Mini App: lightbox ảnh/video đánh giá', () => {
  test.beforeEach(({ api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug/reviews', { average: 4, count: 1, videoCount: 1, distribution: { '4': 1 }, items: [REVIEW], nextCursor: null });
  });

  const openAt = async (page: import('@playwright/test').Page, index: number) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await reviews.scrollIntoViewIfNeeded();
    await expect(reviews.getByText(REVIEW.comment)).toBeVisible({ timeout: 15_000 });
    await reviews.getByRole('button', { name: `Xem ảnh đánh giá ${index}` }).click();
    const box = page.getByRole('dialog', { name: 'Ảnh và video đánh giá' });
    await expect(box).toBeVisible();
    return box;
  };

  test('mở đúng tệp, Trước/Sau quay vòng tới video, phím mũi tên, vuốt ngang, Esc đóng', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const box = await openAt(page, 2);
    const counter = box.locator('[aria-live="polite"]');
    await expect(counter).toHaveText('2 / 3');
    await expect(box.getByText('Lan')).toBeVisible();
    await expect(box.getByText('Đã mua hàng')).toBeVisible();
    await expect(box.getByText(REVIEW.comment)).toBeVisible();
    await expect(counter).toHaveCSS('font-variant-numeric', /tabular-nums/);

    await box.getByRole('button', { name: 'Tệp sau' }).click();
    await expect(counter).toHaveText('3 / 3');
    await expect(box.locator('video[controls]')).toBeVisible();
    await box.getByRole('button', { name: 'Tệp sau' }).click();
    await expect(counter).toHaveText('1 / 3');
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('3 / 3');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('1 / 3');

    const pad = await box.locator('[style*="touch-action"]').boundingBox();
    const y = pad!.y + 60;
    await page.mouse.move(pad!.x + pad!.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(pad!.x + 40, y + 4, { steps: 6 });
    await page.mouse.up();
    await expect(counter).toHaveText('2 / 3');

    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
  });

  test('nút back của Zalo đóng lightbox, ở lại trang sản phẩm', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const box = await openAt(page, 1);
    await page.goBack();
    await expect(box).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}`));
  });

  test('nút × bấm được bằng chuột thật: lightbox phủ trên thanh back của Zalo, × nằm bên trái chừa góc phải cho capsule', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const box = await openAt(page, 1);
    const close = box.getByRole('button', { name: 'Đóng' });
    const rect = await close.boundingBox();
    expect(rect!.x + rect!.width / 2, '× phải nằm nửa trái màn hình').toBeLessThan(375 / 2);
    const topmost = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest('[data-testid="review-lightbox"]');
    }, { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 });
    expect(topmost, 'điểm giữa nút × bị phần tử ngoài lightbox che').toBe(true);
    await close.click();
    await expect(box).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}`));
  });

  test('"Thêm vào giỏ" ở chân đóng lightbox rồi thêm đúng một lần vào giỏ', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const box = await openAt(page, 1);
    const posted = api.waitForCall('POST', '/cart/items');
    await box.getByRole('button', { name: /Thêm vào giỏ/ }).click();
    await posted;
    await expect(box).toHaveCount(0);
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);
  });

  test('mở bằng đường cong drawer 220ms; giảm chuyển động thì hiện ngay', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const anim = (box: import('@playwright/test').Locator) =>
      box.evaluate((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, duration: s.animationDuration, blur: s.backdropFilter || s.getPropertyValue('-webkit-backdrop-filter') };
      });
    const box = await openAt(page, 1);
    const normal = await anim(box);
    expect(normal.name).toBe('review-lightbox-in');
    expect(normal.duration).toBe('0.22s');
    expect(normal.blur).toContain('blur');
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const again = await page.getByRole('region', { name: 'Đánh giá sản phẩm' }).getByRole('button', { name: 'Xem ảnh đánh giá 1' });
    await again.click();
    const reduced = await anim(page.getByRole('dialog', { name: 'Ảnh và video đánh giá' }));
    expect(reduced.name).toBe('none');
  });

  for (const width of WIDTHS) {
    test(`${width}px: vùng chạm thật ≥ 44px và không tràn ngang`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const box = await openAt(page, 2);
      await expect(box.getByRole('button', { name: 'Tệp sau' })).toBeVisible();
      expect(await probeTapTargets(page, { scope: '[data-testid="review-lightbox"]' }), `${width}px: vùng chạm dưới 44px`).toEqual([]);
      const f = await probeLayout(page, { scope: '[data-testid="review-lightbox"]' });
      expect(f.overflow, `${width}px: tràn ngang`).toEqual([]);
      expect(f.notTabular, `${width}px: số không đều`).toEqual([]);
      const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(doc, `${width}px: trang cuộn ngang`).toBeLessThanOrEqual(0);
    });
  }
});
