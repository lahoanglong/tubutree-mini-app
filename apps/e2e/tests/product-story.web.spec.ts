import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';
import { blockingViolations, runAxe } from './support/axe';

/**
 * Web khách khổ 375px: dải câu chuyện sản phẩm nằm ngay dưới khối mua nhanh (sau ô Số lượng, trước Combo) và sprite nguyên liệu rộng 24% khung sân khấu như Mini App.
 * Phần server của Next gọi API thật nên spec dùng sản phẩm mẫu của seed (dầu gội Pơ Lang, có kịch bản mẫu); mọi lời gọi từ trình duyệt đi qua mock.
 */
const SLUG = 'dau-goi-buoi-po-lang';
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

async function seeded(request: APIRequestContext): Promise<{ variations: { id: string; stock: number }[] } | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${SLUG}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as { variations: { id: string; stock: number }[] }) : null;
}

test.describe('Web khách 375px: câu chuyện sản phẩm', () => {
  test('dải ở dưới khối mua nhanh, một bản hiện, sprite 24% khung, không tràn ngang, khung toàn màn mở và đóng, axe sạch', async ({ page, api, request }) => {
    const p = await seeded(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${SLUG}`, { variations: p!.variations });
    api.get(`/products/${SLUG}/related`, []);
    api.get(`/products/${SLUG}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get(`/products/${SLUG}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
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

    await story.getByTestId('story-step-chip').nth(1).click();
    const ratio = await story.evaluate((el) => {
      const stage = el.querySelector<HTMLElement>('[data-testid="story-stage"]')!;
      const layer = el.querySelector<HTMLElement>('[data-testid="story-layer"]')!;
      return layer.offsetWidth / stage.offsetWidth;
    });
    expect(ratio).toBeGreaterThan(0.23);
    expect(ratio).toBeLessThan(0.25);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('web', 'Câu chuyện sản phẩm', found)).toEqual([]);

    await story.getByTestId('pdp-story-open').click();
    const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    await expect(dialog).toBeVisible();

    // Cuộn tới mốc cuối của khung toàn màn: sân khấu vẫn nằm trong màn và bước cuối sáng mà không cần chạm chip (đường cuộn phải đủ dài để mốc cuối chạm dải kích hoạt).
    await dialog.locator('.tubu-story-sentinel').last().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const chips = dialog.getByTestId('story-step-chip');
    await expect(chips.last()).toHaveAttribute('aria-current', 'step');
    const stageBox = await dialog.getByTestId('story-stage').boundingBox();
    expect(stageBox && stageBox.y >= 0 && stageBox.y + stageBox.height <= 812).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Cùng kiểm ở khổ máy tính: khung toàn màn thấp hơn nên mốc cuối dễ nằm dưới dải kích hoạt khi đã cuộn hết.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('pdp-story-open').locator('visible=true').click();
    const wide = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    await expect(wide).toBeVisible();
    await wide.locator('.tubu-story-sentinel').last().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(wide.getByTestId('story-step-chip').last()).toHaveAttribute('aria-current', 'step');
  });
});
