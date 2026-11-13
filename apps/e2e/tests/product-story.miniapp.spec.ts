import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, productDetail } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';

/**
 * Mini App 375px: dải câu chuyện sản phẩm ở trang chi tiết (ProductStoryShowcase, thẻ chia đôi: sân khấu + các chương). API mock toàn bộ.
 * Mọi chương hiện cùng lúc dạng thẻ `story-step-card`; trang chi tiết không còn nút "Xem câu chuyện sản phẩm" hay khung toàn màn (như web), nút mua nằm ở thanh dưới.
 * Khung toàn màn chỉ còn cho Reel ở Trang chủ (w42a-home-story-reel.miniapp.spec.ts).
 * Dùng slug có kịch bản mẫu (dầu gội Pơ Lang) và hai phân loại nên vòng cung sinh từ phân loại thật.
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
  test('dải hiện ở trang chi tiết: vòng cung chọn phân loại, mọi chương hiện sẵn, bấm thẻ đổi bước, không tràn ngang', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    const story = page.getByTestId('product-story');
    await expect(story).toBeVisible({ timeout: 20_000 });
    await story.scrollIntoViewIfNeeded();

    const arc = story.getByTestId('story-arc-item');
    await expect(arc).toHaveCount(2);
    await arc.nth(1).click();
    await expect(arc.nth(1)).toHaveAttribute('aria-checked', 'true');

    const cards = story.getByTestId('story-step-card');
    await expect(cards).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(cards.nth(i)).toBeVisible();
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveAttribute('aria-current', 'step');
    await expect(cards.nth(2)).toContainText('Bồ kết');

    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('không có nút "Xem câu chuyện sản phẩm" và không dựng khung toàn màn; dải không có nút mua riêng', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    const story = page.getByTestId('product-story');
    await expect(story).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
    for (const id of ['story-add-to-cart', 'story-buy-now', 'story-close']) await expect(story.getByTestId(id)).toHaveCount(0);
  });

  test('hết hàng: dải vẫn hiện đủ chương, không có nút mua nào trong dải', async ({ page, api }) => {
    mockStoryProduct(api, 0);
    await page.goto(`/product/${SLUG}`);
    const story = page.getByTestId('product-story');
    await expect(story).toBeVisible({ timeout: 20_000 });
    await expect(story.getByTestId('story-step-card')).toHaveCount(5);
    await expect(story.getByTestId('story-add-to-cart')).toHaveCount(0);
  });

  test('axe serious/critical: dải trong trang', async ({ page, api }) => {
    mockStoryProduct(api);
    await page.goto(`/product/${SLUG}`);
    await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('miniapp', 'Câu chuyện sản phẩm', found)).toEqual([]);
    expect(staleBaseline('miniapp', 'Câu chuyện sản phẩm', found)).toEqual([]);
  });
});
