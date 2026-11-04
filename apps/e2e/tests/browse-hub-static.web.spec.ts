import { test, expect } from './support/mock-api';

/**
 * Hub /san-pham (không tham số lọc) là bản ISR: middleware viết lại sang app/hub-san-pham. Trang có từ khoá vẫn động, không cache.
 * Hub ↔ danh sách giờ là hai route khác nhau (BrowseView mount lại), nên kiểm cả luồng tìm → Back và ô tìm sau khi quay về.
 */
const sMaxAge = (cacheControl: string | undefined) => Number(/s-maxage=(\d+)/.exec(cacheControl ?? '')?.[1] ?? 0);

test.describe('hub /san-pham tĩnh', () => {
  test('hub (kể cả có utm) trả từ cache ISR, có s-maxage; trang có từ khoá thì không', async ({ request, baseURL }) => {
    for (const path of ['/san-pham', '/san-pham', '/san-pham?utm_source=zalo&fbclid=abc']) {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['x-nextjs-cache'], path).toMatch(/^(HIT|STALE)$/);
      expect(sMaxAge(res.headers()['cache-control']), path).toBeGreaterThan(0);
    }
    const search = await request.get(`${baseURL}/san-pham?q=dau-goi`);
    expect(search.status()).toBe(200);
    expect(search.headers()['x-nextjs-cache']).toBeUndefined();
    expect(sMaxAge(search.headers()['cache-control'])).toBe(0);
  });

  test('vào thẳng đường dẫn nội bộ của bản tĩnh: 308 về /san-pham', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/hub-san-pham`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers()['location']!, baseURL).pathname).toBe('/san-pham');
  });

  test('tìm từ hub rồi Back: về hub, ô tìm gõ được; ?focus=search vẫn đặt con trỏ vào ô tìm', async ({ page, api }) => {
    api.get('/categories', [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }]);
    api.get('/brands', [{ brand: 'Tubu', count: 3 }]);
    api.get('/flash-sales/active', []);
    api.get('/search/suggest', [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 }]);
    api.get('/products', { data: [], meta: { page: 1, limit: 20, total: 0 } });
    api.allowUnmocked('GET /products/best-sellers', 'GET /me/coupons', 'POST /events', 'GET /me/wishlist/ids', 'GET /cart');

    await page.goto('/san-pham');
    const input = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    // Ô tìm của header ẩn ở /san-pham (trang có ô riêng): bản tĩnh cũng phải ẩn, chỉ còn một ô.
    await expect(input).toHaveCount(1);
    await input.fill('xyz');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/san-pham\?q=xyz$/);
    // Từ khoá không dựng ở máy chủ: danh sách tải ở trình duyệt (qua mock).
    await expect(page.getByText('Không tìm thấy "xyz"')).toBeVisible();
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('q') === 'xyz')).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(/\/san-pham$/);
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible();
    const back = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await back.fill('nước');
    await expect(page.getByRole('button', { name: /Nước rửa chén/ })).toBeVisible();

    await page.goto('/san-pham?focus=search');
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeFocused();
  });

  test('hub → danh sách → Back: giữ vị trí cuộn của hub', async ({ page, api }) => {
    api.get('/flash-sales/active', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 20, total: 0 } });
    api.allowUnmocked('GET /categories', 'GET /brands', 'GET /products/best-sellers', 'GET /me/coupons', 'POST /events', 'GET /me/wishlist/ids', 'GET /cart', 'GET /search/suggest');
    await page.setViewportSize({ width: 375, height: 640 });
    await page.goto('/san-pham');
    const all = page.getByRole('button', { name: 'Xem tất cả sản phẩm' });
    await expect(all).toBeVisible();
    const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    test.skip(maxY < 200, 'hub quá ngắn để kiểm vị trí cuộn');
    const target = Math.min(400, maxY);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await page.waitForTimeout(300);
    await all.click();
    await expect(page).toHaveURL(/\/san-pham\?all=1$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/san-pham$/);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(target - 80);
  });
});

test.describe('ô tìm ở /san-pham sau khi hub thành route riêng', () => {
  test('/san-pham?focus=search tải đầy đủ: không lỗi hydrate, ô tìm có con trỏ', async ({ page, api }) => {
    api.get('/flash-sales/active', []);
    api.allowUnmocked('GET /categories', 'GET /brands', 'GET /products', 'GET /products/best-sellers', 'GET /me/coupons', 'POST /events', 'GET /me/wishlist/ids', 'GET /cart', 'GET /search/suggest');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /hydrat|did not match/i.test(m.text())) errors.push(m.text());
    });
    await page.goto('/san-pham?focus=search');
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeFocused();
    await expect(page).toHaveURL(/\/san-pham$/);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('gõ, Enter, bấm X: ô tìm vẫn giữ con trỏ và hiện Tìm gần đây; Back về hub trước đó', async ({ page, api }) => {
    api.get('/flash-sales/active', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 20, total: 0 } });
    api.get('/search/suggest', []);
    api.allowUnmocked('GET /categories', 'GET /brands', 'GET /products/best-sellers', 'GET /me/coupons', 'POST /events', 'GET /me/wishlist/ids', 'GET /cart');
    await page.goto('/gio-hang');
    await page.goto('/san-pham');
    const input = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await input.fill('xa phong');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/san-pham\?q=xa(\+|%20)phong$/);
    await page.getByRole('button', { name: 'Xoá từ khoá' }).click();
    await expect(page).toHaveURL(/\/san-pham$/);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await expect(page.getByText('Tìm gần đây')).toBeVisible();
    await expect(page.getByText('xa phong', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/san-pham$/);
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible();
  });
});
