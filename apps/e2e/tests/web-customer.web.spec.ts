import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke web khách (Next, public). Server Next gọi API từ phía server nên không mock được: chạy với API thật
 * và dữ liệu DB tuỳ môi trường (CI rỗng) → chỉ kiểm cấu trúc/sức khoẻ, không đếm hay so tên sản phẩm.
 * Host phải là localhost (baseURL): middleware coi nhãn đầu của Host là subdomain gian hàng, 127.0.0.1 sẽ sai.
 */

function watchHealth(page: Page) {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500 && new URL(r.url()).origin === new URL(page.url() || r.url()).origin) {
      serverErrors.push(`${r.status()} ${r.url()}`);
    }
  });
  return { pageErrors, serverErrors };
}

async function expectHealthyPage(page: Page, path: string) {
  const health = watchHealth(page);
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('footer a[href^="tel:"]')).toBeVisible();
  await expect(page.locator('footer a[href^="mailto:"]')).toBeVisible();
  expect(health.pageErrors).toEqual([]);
  expect(health.serverErrors).toEqual([]);
}

test.describe('Web khách (smoke)', () => {
  test('trang chủ: 200, 1 main, 1 h1, footer hỗ trợ, không lỗi', async ({ page }) => {
    await expectHealthyPage(page, '/');
  });

  test('sản phẩm không tồn tại: hiện trang not-found, không phải lỗi 500', async ({ page }) => {
    const health = watchHealth(page);
    const res = await page.goto('/san-pham/slug-khong-ton-tai-e2e-web');
    // root loading.tsx làm Next stream 200 trước khi notFound() chạy, nên status không phải 404; xem chú thích ở app/product/[slug]/route.ts.
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeVisible();
    expect(health.pageErrors).toEqual([]);
    expect(health.serverErrors).toEqual([]);
  });

  test('/gio-hang: render được khi chưa đăng nhập', async ({ page }) => {
    await expectHealthyPage(page, '/gio-hang');
  });

  test('/dang-nhap: render được, có đúng 1 main và 1 h1', async ({ page }) => {
    await expectHealthyPage(page, '/dang-nhap');
  });

  test('robots.txt: 200 và trỏ tới sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/^User-Agent:/im);
    expect(await res.text()).toMatch(/^Sitemap:\s*\S+\/sitemap\.xml/im);
  });

  test('sitemap.xml: 200 và là XML đúng dạng urlset', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/xml/);
    const body = (await res.text()).trim();
    expect(body).toMatch(/^<\?xml[^>]*\?>\s*<urlset[\s>]/);
    expect(body).toMatch(/<\/urlset>$/);
    expect(body).toMatch(/<loc>[^<]+<\/loc>/);
    expect((body.match(/<url>/g) ?? []).length).toBe((body.match(/<\/url>/g) ?? []).length);
  });

  test('ô tìm kiếm: gửi từ khoá điều hướng tới /?q=... và trang vẫn render', async ({ page }) => {
    const health = watchHealth(page);
    await page.goto('/');
    const input = page.locator('#site-search-q');
    await input.fill('xanh');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/\?q=xanh/);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(health.pageErrors).toEqual([]);
    expect(health.serverErrors).toEqual([]);
  });
});
