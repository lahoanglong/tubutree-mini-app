import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { HOME_SUGGEST } from './support/home-brands';
import { homeHierarchyProblems } from './support/home-hierarchy';
import { mockMergedHome } from './support/home-merged';
import { mockWorld } from './support/order-detail-states';
import { stateOf } from './support/order-tracking-flow';
import { orderDetailProblems, overflowProblems, shootW47, sortBarProblems, suggestGridProblems } from './support/w47-declutter';

/**
 * Nghiệm thu W47-02 ở 375px và 360px trên Mini App: Trang chủ (một lưới lối tắt, một hàng chip Thương hiệu, cuối trang lưới "Gợi ý cho bạn" 2 cột),
 * Duyệt (Sắp xếp + Lọc một thanh dính 44px) và Chi tiết đơn (hero ≤3 phần, một thẻ Vận chuyển gồm hành trình + viên mã + địa chỉ, sản phẩm phía dưới).
 * Có W47_SHOT_DIR thì chụp từng màn vào thư mục đó.
 */
for (const width of [375, 360]) {
  test.describe(`Mini App ${width}px: Trang chủ, Duyệt, Chi tiết đơn gọn (W47)`, () => {
    test('Trang chủ: lưới lối tắt tối đa 2 hàng, chip Thương hiệu là lối duy nhất theo nhãn, cuối trang lưới Gợi ý cho bạn 2 cột', async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockDiscovery(api, { returning: true });
      mockMergedHome(api);
      await page.goto('/');
      await expect(page.getByTestId('shortcut-grid').locator('.tubu-shortcut-cell').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('home-brand-bar').getByRole('button').first()).toBeVisible({ timeout: 15_000 });
      expect(await homeHierarchyProblems(page, { retail: false })).toEqual([]);
      await expect(page.getByRole('region', { name: 'Khám phá theo Thương hiệu' })).toHaveCount(0);
      await shootW47(page, 'miniapp', width, 'home');

      const suggest = page.getByRole('region', { name: HOME_SUGGEST });
      await suggest.scrollIntoViewIfNeeded();
      await expect(suggest.locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 15_000 });
      expect(await suggestGridProblems(page)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'miniapp', width, 'home-suggest');
    });

    test('Duyệt: danh sách có Sắp xếp + Lọc chung một thanh dính 44px; hai nhãn thật thì bộ lọc có nhóm Thương hiệu', async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockDiscovery(api);
      await page.goto('/browse');
      await expect(page.locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 20_000 });
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'miniapp', width, 'browse');

      await page.goto('/browse?brand=Tubu');
      await expect(page.getByRole('group', { name: 'Sắp xếp' })).toBeVisible({ timeout: 20_000 });
      expect(await sortBarProblems(page)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'miniapp', width, 'browse-list');
      await page.getByRole('button', { name: /^Lọc/ }).click();
      await expect(page.getByTestId('filter-brand-scroll')).toBeVisible();
    });

    test('Duyệt: chỉ một nhãn thật ngoài "Tubu Tree" thì không có lưới logo ở hub, bộ lọc không có nhóm Thương hiệu', async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockDiscovery(api);
      api.get('/brands', [{ brand: 'Tubu Tree', count: 30 }, { brand: 'Visante', count: 4 }]);
      await page.goto('/browse');
      await expect(page.locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#browse-brands')).toHaveCount(0);
      await page.goto('/browse?brand=Visante');
      await expect(page.getByRole('group', { name: 'Sắp xếp' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /^Lọc/ }).click();
      await expect(page.getByRole('button', { name: 'Xoá bộ lọc' })).toBeVisible();
      await expect(page.getByText('Khoảng giá', { exact: true })).toBeVisible();
      await expect(page.getByTestId('filter-brand-scroll')).toHaveCount(0);
    });

    test('Chi tiết đơn đang giao: hero ≤3 phần, một thẻ Vận chuyển (hành trình + viên mã + địa chỉ) rồi mới tới sản phẩm', async ({ page, api }) => {
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/order/${w.order.code}`);
      await state.ready(page);
      expect(await orderDetailProblems(page, w.order.items[0]!.productName)).toEqual([]);
      expect(await overflowProblems(page)).toEqual([]);
      await shootW47(page, 'miniapp', width, 'order-detail');
    });
  });
}
