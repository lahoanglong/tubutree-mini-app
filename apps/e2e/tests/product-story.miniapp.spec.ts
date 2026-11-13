import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, productDetail } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';

/**
 * Mini App 375px: dải câu chuyện sản phẩm ở trang chi tiết (ProductStoryShowcase) và khung toàn màn. API mock toàn bộ.
 * Dùng slug có kịch bản mẫu (dầu gội Pơ Lang) và hai phân loại nên vòng cung sinh từ phân loại thật. Kịch bản mẫu không có ảnh tách nền
 * nên khung ảnh là thẻ nổi: không lớp nguyên liệu, không chú thích đè ảnh; điểm nhấn thành chip dưới ảnh. Mọi chương hiện sẵn thành thẻ bấm được.
 */
test.use({ viewport: { width: 375, height: 812 } });

const SLUG = 'dau-goi-buoi-po-lang';
const BASE = CATALOG[0]!;

function mockStoryProduct(api: MockApi, stock = 5): void {
  mockDiscovery(api);
  api.get('/products/:slug', () => ({
    ...productDetail(BASE.slug)!,
    slug: SLUG,
    brand: 'Pơ Lang',
    name: 'Dầu gội bưởi Pơ Lang',
    shortDesc: 'Dầu gội thảo dược tinh dầu bưởi, giảm rụng tóc.',
    certifications: ['Vegan'],
    ingredients: [
      { name: 'Tinh dầu bưởi', percentage: '2%', benefit: 'Kích thích mọc tóc, giảm gãy rụng' },
      { name: 'Bồ kết', benefit: 'Làm sạch dịu nhẹ, sạch gàu tự nhiên' },
      { name: 'Hương nhu', benefit: 'Thư giãn da đầu, mượt tóc' },
    ],
    variations: [
      { id: 'story-v1', sku: 'POLANG-SP-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 165_000, salePrice: null, stock },
      { id: 'story-v2', sku: 'POLANG-SP-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 245_000, salePrice: 219_000, stock },
    ],
  }));
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('câu chuyện sản phẩm — Mini App 375px', () => {
  test('dải hiện ở trang chi tiết: vòng cung chọn phân loại, mọi chương hiện sẵn thành thẻ, điểm nhấn thành chip dưới ảnh, không tràn ngang', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    const story = page.getByTestId('product-story');
    await expect(story).toBeVisible({ timeout: 20_000 });
    await story.scrollIntoViewIfNeeded();
    await expect(story).toHaveAttribute('data-inline', 'true');

    const arc = story.getByTestId('story-arc-item');
    await expect(arc).toHaveCount(2);
    await arc.nth(1).click();
    await expect(arc.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(arc.nth(0)).toHaveAttribute('aria-checked', 'false');

    // Khung ảnh poster (thẻ nổi): không lớp nguyên liệu, không HUD đè ảnh; điểm nhấn nằm ngoài khung, dưới ảnh.
    const stage = story.getByTestId('story-stage');
    await expect(stage).toHaveAttribute('data-frame', 'floating-card');
    await expect(story.getByTestId('story-layer')).toHaveCount(0);
    await expect(story.getByTestId('story-hud')).toHaveCount(0);
    await expect(story.getByTestId('story-callout')).toHaveCount(0);
    const points = story.getByTestId('story-points');
    await expect(points.getByTestId('story-point')).toHaveCount(3);
    await expect(points.getByTestId('story-point').nth(0)).toContainText('Tinh dầu bưởi');
    await expect(points.getByTestId('story-point').nth(1)).toContainText('Bồ kết');
    await expect(points.getByTestId('story-point').nth(2)).toContainText('Hương nhu');
    await expect(stage.getByTestId('story-point')).toHaveCount(0);
    await expect(story.getByTestId('story-closing')).toContainText('Dầu gội thảo dược Pơ Lang');

    // Cả năm chương cùng hiện (đọc không cần chọn); chạm một thẻ chọn chương đó (aria-current), thẻ cũ bỏ dấu.
    const nav = story.getByRole('navigation', { name: 'Các bước' });
    const cards = nav.getByTestId('story-step-card');
    await expect(nav.locator('ol > li')).toHaveCount(5);
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toHaveAttribute('aria-current', 'step');
    await expect(cards.nth(0)).toContainText('Nguyên liệu chính');
    await expect(cards.nth(4)).toContainText('Dùng hằng ngày');
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveAttribute('aria-current', 'step');
    await expect(cards.nth(2)).toContainText('Bồ kết');
    await expect(cards.nth(0)).not.toHaveAttribute('aria-current', 'step');
    await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(cards.nth(0)).toContainText('Nguyên liệu chính');
    await expect(story.getByTestId('story-layer')).toHaveCount(0);

    // Không có chip bước, khung chữ một bước hay khối tĩnh riêng nào.
    for (const gone of ['story-step-chip', 'story-step-panel', 'story-static-steps']) await expect(story.getByTestId(gone), gone).toHaveCount(0);

    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('nút trên ảnh mở khung toàn màn, có hai nút mua và đủ năm thẻ chương, Esc đóng', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('story-add-to-cart')).toBeEnabled();
    await expect(dialog.getByTestId('story-buy-now')).toBeEnabled();
    await expect(dialog.getByTestId('story-step-card')).toHaveCount(5);
    await expect(dialog.getByTestId('story-step-card').first()).toHaveAttribute('aria-current', 'step');
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('hết hàng: hai nút của khung toàn màn khoá', async ({ page, api }) => {
    mockStoryProduct(api, 0);
    await page.goto(`/product/${SLUG}`);
    await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    await expect(dialog.getByTestId('story-add-to-cart')).toBeDisabled();
    await expect(dialog.getByTestId('story-buy-now')).toBeDisabled();
  });

  test('axe serious/critical: dải trong trang và khung toàn màn', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    let found = await runAxe(page);
    expect(blockingViolations('miniapp', 'Câu chuyện sản phẩm', found)).toEqual([]);
    expect(staleBaseline('miniapp', 'Câu chuyện sản phẩm', found)).toEqual([]);

    await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toBeVisible();
    found = await runAxe(page);
    expect(blockingViolations('miniapp', 'Câu chuyện sản phẩm (toàn màn)', found)).toEqual([]);
  });
});
