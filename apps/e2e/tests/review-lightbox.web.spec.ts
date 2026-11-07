import { test, expect, type MockApi } from './support/mock-api';
import { firstProduct, type PdpProduct } from './support/pdp-product';
import { probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';

/**
 * W42B, web khách: bấm ảnh/video đánh giá ở trang sản phẩm mở lightbox toàn màn hình (ReviewMediaLightbox), cùng chuẩn với Mini App
 * (review-lightbox.miniapp.spec.ts): bộ đếm "n / N" số đều, Trước/Sau ≥ 44px, phím ← → và Esc, vuốt ngang, Tab quay vòng trong hộp, khoá cuộn trang.
 * Phần server của Next gọi API thật (sản phẩm có sẵn trong DB e2e); đánh giá từ trình duyệt đi qua API giả. Khổ điện thoại dò ở 320 / 360 / 375 / 393px.
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
  avatar: null,
  verifiedPurchase: true,
};
const WIDTHS = [320, 360, 375, 393] as const;

function mockPdp(api: MockApi, p: PdpProduct): void {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get('/me/wishlist/ids', []);
  api.get(`/products/${p.slug}/reviews`, { average: 4, count: 1, videoCount: 1, distribution: { '4': 1 }, items: [REVIEW], nextCursor: null });
}

test.describe('Web khách: lightbox ảnh/video đánh giá', () => {
  const open = async (page: import('@playwright/test').Page, slug: string, index: number) => {
    await page.goto(`/san-pham/${slug}`);
    const section = page.locator('[data-section="pdp-reviews"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText(REVIEW.comment)).toBeVisible({ timeout: 30_000 });
    await section.getByRole('button', { name: `Xem ảnh đánh giá ${index}` }).click();
    const box = page.getByRole('dialog', { name: 'Ảnh và video đánh giá' });
    await expect(box).toBeVisible();
    return box;
  };

  test('mở đúng tệp, Trước/Sau quay vòng tới video, phím mũi tên, vuốt ngang, Tab quay vòng, Esc đóng và trả cuộn trang', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 393, height: 800 });
    const box = await open(page, p!.slug, 2);
    const counter = box.locator('[aria-live="polite"]');
    await expect(counter).toHaveText('2 / 3');
    await expect(box.getByText('Lan')).toBeVisible();
    await expect(box.getByText('Đã mua hàng')).toBeVisible();
    await expect(counter).toHaveCSS('font-variant-numeric', /tabular-nums/);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await box.getByRole('button', { name: 'Tệp sau' }).click();
    await expect(counter).toHaveText('3 / 3');
    await expect(box.locator('video[controls]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('1 / 3');
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('3 / 3');

    const pad = await box.locator('[style*="touch-action"]').boundingBox();
    const y = pad!.y + 60;
    await page.mouse.move(pad!.x + pad!.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(pad!.x + 40, y + 4, { steps: 6 });
    await page.mouse.up();
    await expect(counter).toHaveText('1 / 3');

    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="review-lightbox"]')), 'Tab rơi ra ngoài hộp').toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('mở bằng đường cong drawer 220ms; giảm chuyển động thì hiện ngay', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 393, height: 800 });
    const anim = (box: import('@playwright/test').Locator) =>
      box.evaluate((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, duration: s.animationDuration, blur: s.backdropFilter };
      });
    const box = await open(page, p!.slug, 1);
    const normal = await anim(box);
    expect(normal.name).toBe('review-lightbox-in');
    expect(normal.duration).toBe('0.22s');
    expect(normal.blur).toContain('blur');
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-section="pdp-reviews"]').getByRole('button', { name: 'Xem ảnh đánh giá 1' }).click();
    expect((await anim(page.getByRole('dialog', { name: 'Ảnh và video đánh giá' }))).name).toBe('none');
  });

  for (const width of WIDTHS) {
    test(`${width}px: vùng chạm thật ≥ 44px và không tràn ngang`, async ({ page, api, request }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      const p = await firstProduct(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm nào');
      mockPdp(api, p!);
      await page.setViewportSize({ width, height: 700 });
      const box = await open(page, p!.slug, 2);
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
