import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { CATEGORIES } from './support/discovery-mocks';
import { HOME_SUGGEST } from './support/home-brands';
import { homeHierarchyProblems } from './support/home-hierarchy';
import { mockMergedHome } from './support/home-merged';
import { mockWorld } from './support/order-detail-states';
import { stateOf } from './support/order-tracking-flow';
import { refetchStale } from './support/refetch-stale';
import { orderDetailProblems, overflowProblems, shootW47, sortBarProblems, suggestGridProblems } from './support/w47-declutter';

const card = (n: number) => ({
  id: `w47-${n}`, slug: `w47-sp-${n}`, brand: 'Tubu', name: `Món gợi ý ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
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
 * Nghiệm thu W47-02 ở 375px và 360px trên web khổ điện thoại (cùng số đo với `w47-02-declutter.miniapp.spec.ts`): Trang chủ, Duyệt, Chi tiết đơn.
 * Phần máy chủ của Next gọi API thật nên dữ liệu SSR là của DB e2e; khối cần dữ liệu mock thì ép trình duyệt hỏi lại. Có W47_SHOT_DIR thì chụp từng màn vào thư mục đó.
 */
for (const width of [375, 360]) {
  test.describe(`web ${width}px: Trang chủ, Duyệt, Chi tiết đơn gọn (W47)`, () => {
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ: khổ do spec tự đặt');
    });

    test('Trang chủ: lưới lối tắt tối đa 2 hàng, chip Thương hiệu là lối duy nhất theo nhãn, cuối trang lưới Gợi ý cho bạn 2 cột', async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockHome(api);
      await page.goto('/');
      await refetchStale(page, api, 'GET', '/brands');
      await expect(page.getByTestId('home-brand-bar').getByRole('button').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('shortcut-grid').locator('.tubu-shortcut-cell').first()).toBeVisible();
      // Ô Giờ vàng theo suất Giờ vàng mà máy chủ dựng sẵn từ DB e2e: spec này đo bố cục, không đo luật có/không ô Giờ vàng (shop.web.spec.ts).
      const retail = (await page.getByTestId('shortcut-grid').locator('[data-pillar="retail"]').count()) > 0;
      expect(await homeHierarchyProblems(page, { retail })).toEqual([]);
      await expect(page.getByRole('region', { name: 'Khám phá theo Thương hiệu' })).toHaveCount(0);
      await shootW47(page, 'web', width, 'home');

      await page.locator('[data-home-block="suggest"]').scrollIntoViewIfNeeded();
      const suggest = page.getByRole('region', { name: HOME_SUGGEST });
      await suggest.scrollIntoViewIfNeeded();
      await expect(suggest.locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      expect(await suggestGridProblems(page)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'web', width, 'home-suggest');
    });

    test('Duyệt: danh sách có Sắp xếp + Lọc chung một thanh dính 44px, không tràn ngang', async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto('/san-pham');
      await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'web', width, 'browse');

      await page.goto('/san-pham?all=1');
      await expect(page.getByRole('group', { name: 'Sắp xếp' })).toBeVisible({ timeout: 20_000 });
      expect(await sortBarProblems(page)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'web', width, 'browse-list');
    });

    test('Chi tiết đơn đang giao: hero ≤3 phần, một thẻ Vận chuyển (hành trình + viên mã + địa chỉ) rồi mới tới sản phẩm', async ({ page, api }) => {
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'web', state, Date.now());
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
      await state.ready(page);
      expect(await orderDetailProblems(page, w.order.items[0]!.productName)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'web', width, 'order-detail');
    });
  });
}
