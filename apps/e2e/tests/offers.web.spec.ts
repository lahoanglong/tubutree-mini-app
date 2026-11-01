import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG } from './support/discovery-mocks';
import { COLLECTABLE, mockCollectable } from './support/voucher-mocks';

/**
 * Web khách, Ưu đãi (/uu-dai) và Mã giảm giá (/ma-giam-gia): khách chưa đăng nhập xem được Giờ vàng và Nhận mã, "Lưu mã" chuyển tới đăng nhập kèm
 * đường quay lại và KHÔNG gọi /coupons/claim; cả hai trang noindex. Mọi lời gọi /api/** đi qua mock. Host phải là localhost (baseURL) vì middleware coi
 * nhãn đầu của Host là subdomain gian hàng. Cần API thật khởi chạy cùng web nên chạy ở CI (e2e.yml), không chạy trong máy dev đang thiếu RAM.
 */

const HOUR = 3_600_000;

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

test.describe('Web khách: Ưu đãi, chưa đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockFlash(api);
    mockCollectable(api);
  });

  test('/uu-dai: thấy Giờ vàng và Nhận mã; Lưu mã chuyển tới đăng nhập kèm returnTo, không gọi claim', async ({ page, api }) => {
    await page.goto('/uu-dai');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible();
    const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
    await expect(collect).toBeVisible();
    await expect(collect.getByRole('button', { name: 'Lưu mã' })).toHaveCount(COLLECTABLE.length);
    // Mỗi khối cần tài khoản một thẻ mời cùng nhãn "Đăng nhập", Đổi quà vẫn hiện.
    await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true }).getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveAttribute('href', /\/dang-nhap\?returnTo=%2Fuu-dai/);
    await expect(page.getByRole('region', { name: 'Điểm Xanh và điểm danh', exact: true }).getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Đổi quà', exact: true })).toBeVisible();
    await collect.getByRole('button', { name: 'Lưu mã' }).first().click();
    await expect(page).toHaveURL(/\/dang-nhap\?returnTo=%2Fuu-dai/);
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });

  test('/uu-dai và /ma-giam-gia noindex', async ({ page }) => {
    for (const path of ['/uu-dai', '/ma-giam-gia']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });

  test('/ma-giam-gia: Nhận mã xem được; Mã của tôi mời đăng nhập, không gọi /me/coupons', async ({ page, api }) => {
    await page.goto('/ma-giam-gia');
    await expect(page.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('voucher-grid').getByRole('button', { name: 'Lưu mã' })).toHaveCount(COLLECTABLE.length);
    await page.getByRole('tab', { name: 'Mã của tôi' }).click();
    await expect(page).toHaveURL(/tab=mine/);
    await expect(page.getByRole('link', { name: 'Đăng nhập với Zalo' })).toHaveAttribute('href', /\/dang-nhap\?returnTo=.*ma-giam-gia.*tab%3Dmine/);
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
  });
});
