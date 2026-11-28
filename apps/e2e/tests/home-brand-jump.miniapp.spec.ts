import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockMergedHome } from './support/home-merged';

/**
 * Mini 375px, hàng chip Thương hiệu dưới Danh mục (W47: lối duyệt theo thương hiệu DUY NHẤT của Trang chủ, không còn khối "Khám phá theo Thương hiệu"
 * cuối trang để cuộn tới): chạm chip thì mở danh sách lọc theo nhãn (nhãn có trang riêng thì mở trang nhãn).
 */
test.describe('Mini App: chip Thương hiệu mở danh sách của nhãn', () => {
  test('375px: chạm "Visante" mở /browse lọc theo nhãn; Trang chủ không còn khối thương hiệu cuối trang', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockMergedHome(api);
    await page.goto('/');
    const chip = page.getByTestId('home-brand-bar').getByRole('button', { name: 'Visante', exact: true });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Khám phá theo Thương hiệu' })).toHaveCount(0);
    await expect(page.locator('[data-testid="home-brand-section"], [id^="home-brand-"]')).toHaveCount(0);
    await chip.click();
    await expect(page).toHaveURL(/\/browse\?brand=Visante$/, { timeout: 15_000 });
  });
});
