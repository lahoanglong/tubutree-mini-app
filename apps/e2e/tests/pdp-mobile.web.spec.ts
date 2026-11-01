import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';

/**
 * Trang sản phẩm web ở khổ 375px phải giống Mini App ở ba chỗ: tiêu đề mục không chân, ô số lượng gồm hai nút vuông riêng,
 * khối đánh giá rỗng có hình + lời mời. Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong DB e2e
 * và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

async function firstProduct(request: APIRequestContext) {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=1`).catch(() => null);
  if (!res?.ok()) return null;
  const first = ((await res.json()) as { data?: { slug: string }[] }).data?.[0];
  if (!first) return null;
  const detail = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(first.slug)}`);
  return detail.ok() ? ((await detail.json()) as { slug: string; variations: { id: string; stock: number }[] }) : null;
}

test.describe('Web khách: trang sản phẩm khổ điện thoại giống Mini App', () => {
  test('tiêu đề mục không serif, nút số lượng 44px tách riêng, đánh giá rỗng có hình và lời mời', async ({ page, api, request }, testInfo) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } }); // "Có thể bạn cũng thích" của khách vãng lai: bán chạy công khai
    api.get(`/products/${p!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p!.slug}`);

    const family = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFamily = await family('body');
    const promise = page.getByRole('heading', { name: 'Cam kết Tubu' });
    await expect(promise).toBeVisible();
    expect(await promise.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(bodyFamily);

    const minus = page.getByRole('button', { name: 'Giảm số lượng' });
    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    for (const b of [minus, plus]) {
      const box = (await b.boundingBox())!;
      expect(Math.round(box.width)).toBe(44);
      expect(Math.round(box.height)).toBe(44);
      expect(await b.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    }
    expect(await minus.evaluate((el) => getComputedStyle(el.parentElement!).borderTopWidth)).toBe('0px');

    const empty = page.getByText('Chưa có đánh giá', { exact: true });
    await expect(empty).toBeVisible();
    await expect(page.getByText('Hãy là người đầu tiên chia sẻ trải nghiệm.')).toBeVisible();
    await expect(page.locator('#danh-gia svg[aria-hidden="true"]').first()).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('pdp-web375.png'), fullPage: true });
  });
  test('thứ tự khối ở 375px như Mini App: Đánh giá nhanh ngay sau Phân loại/Combo, các dải trắng cách nhau tối đa 8px, không tràn ngang', async ({ page, api, request }, testInfo) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    const review = (id: string, rating: number) => ({
      id,
      rating,
      author: `Khách ${id}`,
      avatar: null,
      comment: `Nhận xét ${id}`,
      images: [],
      videoUrl: null,
      verifiedPurchase: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    // Phân loại đầu hết hàng (nếu có từ hai phân loại), còn lại còn 3: để kiểm chip hết hàng khoá và dòng "Còn 3 sản phẩm" ở khối thông tin chính.
    const multi = p!.variations.length > 1;
    api.get(`/products/${p!.slug}`, { variations: p!.variations.map((v, i) => ({ ...v, stock: multi && i === 0 ? 0 : 3 })) });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get(`/products/${p!.slug}/reviews`, {
      average: 4.5,
      count: 2,
      videoCount: 0,
      distribution: { '5': 1, '4': 1 },
      items: [review('a', 5), review('b', 4)],
    });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p!.slug}`);
    await expect(page.locator('[data-section="pdp-quick-reviews"]')).toBeVisible();
    await expect(page.locator('[data-section="pdp-reviews"]')).toBeVisible();

    const blocks = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-section]'))
        .map((el) => ({ id: el.dataset.section!, ...el.getBoundingClientRect().toJSON() }))
        .filter((b) => b.height > 0)
        .map((b) => ({ id: b.id, top: Math.round(b.y + window.scrollY), bottom: Math.round(b.y + window.scrollY + b.height) }))
        .sort((a, b) => a.top - b.top || a.bottom - b.bottom),
    );
    const ids = blocks.map((b) => b.id);
    // Thứ tự Mini App; khối nào sản phẩm này không có thì vắng, phần còn lại vẫn đúng thứ tự.
    const MINI_ORDER = [
      'pdp-main',
      'pdp-certs',
      'pdp-subscribe',
      'pdp-offers',
      'pdp-variation',
      'pdp-variation-chips',
      'pdp-notes',
      'pdp-bundles',
      'pdp-quick-reviews',
      'pdp-quantity',
      'pdp-groupbuy',
      'pdp-ingredients',
      'pdp-promises',
      'pdp-description',
      'pdp-reviews',
    ];
    expect(ids).toEqual(MINI_ORDER.filter((id) => ids.includes(id)));
    expect(ids.indexOf('pdp-quick-reviews')).toBeLessThan(ids.indexOf('pdp-quantity'));
    expect(ids.indexOf('pdp-quick-reviews')).toBeLessThan(ids.indexOf('pdp-reviews'));

    // "Còn N sản phẩm" nằm trong khối thông tin chính (dưới giá/Điểm Xanh) như Mini App, không trôi xuống dải Phân loại.
    const low = page.locator('[data-testid="pdp-low-stock"]');
    await expect(low).toHaveText('Còn 3 sản phẩm');
    const lowBox = (await low.boundingBox())!;
    const mainBox = (await page.locator('[data-section="pdp-main"]').boundingBox())!;
    expect(lowBox.y).toBeGreaterThanOrEqual(mainBox.y);
    expect(lowBox.y + lowBox.height).toBeLessThanOrEqual(mainBox.y + mainBox.height + 1);

    // Chip phân loại hết hàng khoá như chip của Mini App (không chọn được).
    if (multi) {
      const chips = page.locator('[data-section="pdp-variation-chips"] button[aria-pressed]');
      await expect(chips.first()).toBeDisabled();
      await expect(chips.nth(1)).toBeEnabled();
      await chips.first().click({ force: true });
      await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
    }

    // Từ Đánh giá nhanh trở xuống mỗi khối là một dải trắng riêng cách dải trên đúng 8px (mt-2) trên nền canvas. Đo chính các dải (phần tử
    // nền surface, lấy phần tử trên cùng trong mỗi khối): vỏ khối `data-section` của Combo và Mua chung chưa chứa mt-2 của dải con, đo vỏ
    // thì khe 0 (dính liền thành một mảng trắng) vẫn qua.
    const bands = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--color-bg-surface)';
      document.body.appendChild(probe);
      const surface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const found: { id: string; top: number; bottom: number }[] = [];
      const walk = (el: Element, id: string) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && getComputedStyle(el).backgroundColor === surface) {
          found.push({ id, top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY) });
          return;
        }
        for (const child of Array.from(el.children)) walk(child, id);
      };
      document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => walk(el, el.dataset.section!));
      return found.sort((x, y) => x.top - y.top || x.bottom - y.bottom);
    });
    const bandFrom = bands.findIndex((b) => b.id === 'pdp-quick-reviews');
    expect(bandFrom, 'dải Đánh giá nhanh phải là dải nền surface').toBeGreaterThanOrEqual(0);
    expect(bands.some((b) => b.id === 'pdp-quantity')).toBe(true);
    expect(bands.some((b) => b.id === 'pdp-reviews')).toBe(true);
    for (let i = bandFrom + 1; i < bands.length; i++) {
      const gap = bands[i]!.top - bands[i - 1]!.bottom;
      expect(gap, `${bands[i - 1]!.id} -> ${bands[i]!.id}`).toBeGreaterThanOrEqual(7);
      expect(gap, `${bands[i - 1]!.id} -> ${bands[i]!.id}`).toBeLessThanOrEqual(9);
    }

    // Hàng chip lọc của khối đánh giá đầy đủ như Mini App.
    const chips = page.locator('[data-section="pdp-reviews"] button[aria-pressed]');
    await expect(chips.first()).toHaveText('Tất cả');
    await expect(chips).toHaveText(['Tất cả', '5 sao', '4 sao', '3 sao', 'Có ảnh']);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath('pdp-web375-order.png'), fullPage: true });
  });
  test('khung chờ chi tiết SP: bấm Quay lại lúc trang SP còn đang tải thì ở lại /san-pham, không rời site và không lùi quá một trang', async ({ page, api }) => {
    api.get('/flash-sales/active', []);
    api.get('/categories', []);
    api.get('/brands', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('about:blank');
    await page.goto('/san-pham?all=1');
    const card = page.locator('a[href^="/san-pham/"]').first();
    test.skip((await card.count().catch(() => 0)) === 0, 'DB e2e chưa có sản phẩm nào để bấm');
    await expect(card).toBeVisible();
    const href = (await card.getAttribute('href'))!;
    api.allowUnmocked('GET /products/:slug', 'GET /products/:slug/reviews');
    await page.route(/\/san-pham\/[^/?]+\?_rsc=/, async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue().catch(() => undefined);
    });
    await card.click();
    const skeleton = page.getByTestId('pdp-nav-skeleton');
    await expect(skeleton).toBeVisible();
    await skeleton.getByRole('button', { name: 'Quay lại' }).click();
    await expect(skeleton).toBeHidden();
    await page.waitForTimeout(7500);
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(test.info().project.use.baseURL ?? page.url()).origin);
    expect(url.pathname).toBe('/san-pham');
    expect(url.pathname).not.toBe(href);
    await expect(page.getByRole('button', { name: 'Tăng số lượng' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Tất cả sản phẩm' })).toBeAttached();
    await page.screenshot({ path: test.info().outputPath('pdp-back-stay.png') });
  });
});
