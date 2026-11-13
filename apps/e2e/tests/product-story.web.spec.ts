import type { APIRequestContext } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { blockingViolations, runAxe } from './support/axe';

/**
 * Web khách: dải câu chuyện sản phẩm (thẻ chia đôi: sân khấu + các chương) nằm ngay dưới khối mua nhanh (sau ô Số lượng, trước Combo) ở 375px và ở đầu phần dưới từ md.
 * Mọi chương hiện cùng lúc dạng thẻ `story-step-card`, bấm một thẻ để chọn; PDP không còn nút hay khung toàn màn mở lại cùng nội dung (khung toàn màn chỉ còn cho Reel ở Trang chủ).
 * Phần server của Next gọi API thật nên spec dùng sản phẩm mẫu của seed (dầu gội Pơ Lang, có kịch bản mẫu); mọi lời gọi từ trình duyệt đi qua mock.
 */
const SLUG = 'dau-goi-buoi-po-lang';
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

type Seeded = { variations: { id: string; stock: number }[] };

async function seeded(request: APIRequestContext): Promise<Seeded | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${SLUG}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Seeded) : null;
}

function mockPdp(api: MockApi, p: Seeded): void {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${SLUG}`, { variations: p.variations });
  api.get(`/products/${SLUG}/related`, []);
  api.get(`/products/${SLUG}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${SLUG}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
}

test.describe('Web khách: câu chuyện sản phẩm', () => {
  test('375px: dải ở dưới khối mua nhanh, một bản hiện, mọi chương hiện sẵn và bấm thẻ để chọn, không tràn ngang, không nút/khung toàn màn, axe sạch', async ({ page, api, request }) => {
    const p = await seeded(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${SLUG}`);

    const stories = page.locator('[data-section="pdp-story"]');
    await expect(stories).toHaveCount(2);
    const story = stories.locator('visible=true');
    await expect(story).toHaveCount(1);
    await story.scrollIntoViewIfNeeded();

    const inInfo = await story.evaluate((el) => !!el.closest('[data-testid="pdp-info"]'));
    expect(inInfo).toBe(true);

    const qty = page.getByRole('button', { name: 'Tăng số lượng' });
    const qtyBox = await qty.boundingBox();
    const storyBox = await story.boundingBox();
    expect(qtyBox && storyBox && storyBox.y > qtyBox.y).toBe(true);

    // Mọi chương cùng hiện (không còn mốc cuộn hay chip chỉ hiện một bước): bấm thẻ nào thì thẻ đó mang aria-current.
    const cards = story.getByTestId('story-step-card');
    const total = await cards.count();
    expect(total).toBeGreaterThan(1);
    for (let i = 0; i < total; i++) await expect(cards.nth(i)).toBeVisible();
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(cards.nth(0)).not.toHaveAttribute('aria-current', 'step');

    // Sprite nguyên liệu chỉ vẽ trên ảnh tách nền (frame "cutout"), rộng 24% khung sân khấu; ảnh thường thì không vẽ lớp nào đè lên ảnh.
    const frame = await story.getByTestId('story-stage').getAttribute('data-frame');
    if (frame === 'cutout') {
      const ratio = await story.evaluate((el) => {
        const stage = el.querySelector<HTMLElement>('[data-testid="story-stage"]')!;
        const layer = el.querySelector<HTMLElement>('[data-testid="story-layer"]')!;
        return layer.offsetWidth / stage.offsetWidth;
      });
      expect(ratio).toBeGreaterThan(0.23);
      expect(ratio).toBeLessThan(0.25);
    } else {
      await expect(story.getByTestId('story-layer')).toHaveCount(0);
      await expect(story.getByTestId('story-hud')).toHaveCount(0);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await expect(page.getByTestId('pdp-story-open')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);

    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('web', 'Câu chuyện sản phẩm', found)).toEqual([]);
  });

  test('máy tính 1280px: bản đầu phần dưới hiện, bản điện thoại ẩn; chọn thẻ chương, không nút hay khung toàn màn', async ({ page, api, request }) => {
    const p = await seeded(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/san-pham/${SLUG}`);

    const story = page.locator('[data-section="pdp-story"]').locator('visible=true');
    await expect(story).toHaveCount(1);
    // Bản máy tính nằm ở phần dưới (ngoài cột thông tin), khác bản điện thoại nằm trong cột thông tin.
    expect(await story.evaluate((el) => !!el.closest('[data-testid="pdp-info"]'))).toBe(false);
    await story.scrollIntoViewIfNeeded();

    const cards = story.getByTestId('story-step-card');
    const total = await cards.count();
    expect(total).toBeGreaterThan(1);
    await cards.nth(total - 1).click();
    await expect(cards.nth(total - 1)).toHaveAttribute('aria-current', 'step');

    await expect(page.getByTestId('pdp-story-open')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
