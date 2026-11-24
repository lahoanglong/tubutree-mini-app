import { HOME_HEADER_HEIGHT } from '../../../packages/app-core/src/home-layout';
import { test, expect } from './support/mock-api';
import { catalogHandler, mockDiscovery } from './support/discovery-mocks';
import { mockMergedHome } from './support/home-merged';

/**
 * Mini 375px, hàng chip Thương hiệu (w34-02): chạm chip của nhãn cuối thì trang dừng đúng tiêu đề nhãn đó dù các nhãn phía trên chưa tải lúc chạm.
 * Nhãn chưa tới gần màn giữ chỗ cao đúng lưới thật nên khi chúng tải trong lúc cuộn, đích không bị đẩy xuống (WebView iOS không có neo cuộn).
 */
test.describe('Mini App: chip Thương hiệu nhảy tới đúng nhãn', () => {
  test.beforeEach(async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockMergedHome(api);
    // Catalog mock chỉ đủ 4 món cho Tubu (Mộc An có 2 dù /brands báo 5): nhãn khác mượn món Tubu để mọi nhãn có đúng lưới 4 món như số /brands báo.
    const catalog = catalogHandler();
    api.get('/products', ({ call }) => {
      const brand = call.query.get('brand');
      if (!brand || brand === 'Tubu') return catalog({ call });
      const query = new URLSearchParams(call.query);
      query.set('brand', 'Tubu');
      return catalog({ call: { ...call, query } });
    });
  });

  test('chỗ giữ của nhãn chưa tải cao đúng lưới thật; chạm chip "Visante" dừng tiêu đề nhãn ngay dưới header', async ({ page }) => {
    await page.goto('/');
    const chip = page.getByTestId('home-brand-bar').getByRole('button', { name: 'Visante', exact: true });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    const target = page.locator('#home-brand-visante');
    const reserve = target.getByTestId('catalog-grid-reserve');
    await expect(reserve).toHaveCount(1);
    const reserved = (await reserve.boundingBox())!.height;

    await chip.click();
    await expect(target.getByTestId('catalog-grid').locator('[data-ds="product-tile"]')).toHaveCount(4, { timeout: 15_000 });
    const grid = (await target.getByTestId('catalog-grid').boundingBox())!.height;
    expect(Math.abs(grid - reserved), `lưới thật ${grid}px, chỗ giữ ${reserved}px`).toBeLessThanOrEqual(1);
    // Chờ cuộn mượt dừng rồi đo: tiêu đề nhãn nằm ngay dưới header dính (scroll-padding-top của `.zaui-page` = header + 8).
    await expect.poll(async () => Math.round((await target.boundingBox())!.y), { timeout: 5_000 }).toBeGreaterThanOrEqual(HOME_HEADER_HEIGHT);
    await page.waitForTimeout(600);
    const top = Math.round((await target.boundingBox())!.y);
    expect(top, `tiêu đề nhãn ở y=${top}`).toBeGreaterThanOrEqual(HOME_HEADER_HEIGHT);
    expect(top, `tiêu đề nhãn ở y=${top}`).toBeLessThanOrEqual(HOME_HEADER_HEIGHT + 16);
  });
});
