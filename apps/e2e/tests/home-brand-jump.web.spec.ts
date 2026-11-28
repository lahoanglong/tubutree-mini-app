import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { CATEGORIES } from './support/discovery-mocks';
import { mockMergedHome } from './support/home-merged';
import { refetchStale } from './support/refetch-stale';

const card = (n: number) => ({
  id: `bj-${n}`, slug: `bj-sp-${n}`, brand: 'Tubu', name: `Món nhãn ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
  ratingAvg: 4.6, reviewCount: 9, sold: 120 + n,
});

function mockHome(api: MockApi) {
  api.get('/me/subscriptions', []);
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/upcoming', []);
  mockMergedHome(api);
  // Ép hỏi lại thương hiệu làm mọi query hết tươi hỏi lại, kể cả danh mục (khối chứa thanh chip): thiếu mock thì khối đó rơi vào khung lỗi.
  api.get('/categories', CATEGORIES);
  // Cấu hình công khai cũng bị hỏi lại; mặc định của mock là `{}`, đầu và chân trang web cần đủ trường.
  api.get('/config/public', publicConfig());
  api.get('/products', ({ call }) => {
    const limit = Number(call.query.get('limit') ?? '20');
    return { data: Array.from({ length: limit }, (_, i) => card(i + 1)), meta: { page: 1, limit, total: limit }, filtersIgnored: false };
  });
}

/**
 * Web 375px và 1280px, hàng chip Thương hiệu dưới Danh mục (W47: lối duyệt theo thương hiệu DUY NHẤT của Trang chủ, không còn khối "Khám phá theo
 * Thương hiệu" cuối trang để cuộn tới): chạm chip thì mở danh sách sản phẩm lọc theo nhãn.
 */
for (const width of [375, 1280]) {
  test(`web ${width}px: chạm "Visante" mở /san-pham lọc theo nhãn; Trang chủ không còn khối thương hiệu cuối trang`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 900 });
    mockHome(api);
    await page.goto('/');
    // Thương hiệu trong HTML đầu là của DB e2e (máy chủ dựng sẵn thanh chip): ép trình duyệt hỏi lại mock.
    await refetchStale(page, api, 'GET', '/brands');
    const chip = page.getByTestId('home-brand-bar').getByRole('button', { name: 'Visante', exact: true });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Khám phá theo Thương hiệu' })).toHaveCount(0);
    await expect(page.locator('[data-testid="home-brand-section"], [id^="home-brand-"]')).toHaveCount(0);
    await chip.click();
    await expect(page).toHaveURL(/\/san-pham\?brand=Visante$/, { timeout: 15_000 });
  });
}
