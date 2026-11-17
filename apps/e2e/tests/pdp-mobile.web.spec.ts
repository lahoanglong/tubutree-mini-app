import { test as plain, type Page, type TestInfo } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { PDP_BLOCK_ORDER } from '../../../packages/app-core/src/commerce/pdp-info';
import { assertProductOnCi, firstProduct, multiVariationProduct, singleVariationProduct, type PdpProduct } from './support/pdp-product';

/**
 * Trang sản phẩm web ở khổ 375px phải giống Mini App ở ba chỗ: tiêu đề mục không chân, ô số lượng gồm hai nút vuông riêng,
 * khối đánh giá rỗng chỉ một dòng. Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong DB e2e
 * và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock.
 */

test.describe('Web khách: trang sản phẩm khổ điện thoại giống Mini App', () => {
  test('tiêu đề mục không serif, nút số lượng 44px tách riêng, đánh giá rỗng một dòng', async ({ page, api, request }, testInfo) => {
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
    const reviewsTitle = page.locator('#danh-gia-title');
    await expect(reviewsTitle).toBeVisible();
    expect(await reviewsTitle.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(bodyFamily);

    const minus = page.getByRole('button', { name: 'Giảm số lượng' });
    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    for (const b of [minus, plus]) {
      const box = (await b.boundingBox())!;
      expect(Math.round(box.width)).toBe(44);
      expect(Math.round(box.height)).toBe(44);
      expect(await b.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    }
    expect(await minus.evaluate((el) => getComputedStyle(el.parentElement!).borderTopWidth)).toBe('0px');

    // Chưa có đánh giá: khối chỉ một dòng như Mini App, không hình minh hoạ, không lời mời.
    const empty = page.getByText('Chưa có đánh giá', { exact: true });
    await expect(empty).toBeVisible();
    await expect(page.getByText('Hãy là người đầu tiên chia sẻ trải nghiệm.')).toHaveCount(0);
    expect((await page.locator('#danh-gia').boundingBox())!.height).toBeLessThan(140);

    await page.screenshot({ path: testInfo.outputPath('pdp-web375.png'), fullPage: true });
  });
  /** Mock chung của hai ca dưới: mọi lời gọi từ trình duyệt đi qua mock, `stockOf(i)` là tồn của phân loại thứ i. */
  async function openPdp375(page: Page, api: MockApi, p: PdpProduct, stockOf: (index: number) => number): Promise<void> {
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
    api.get(`/products/${p.slug}`, { variations: p.variations.map((v, i) => ({ ...v, stock: stockOf(i) })) });
    api.get(`/products/${p.slug}/related`, []);
    api.get(`/products/${p.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get(`/products/${p.slug}/reviews`, {
      average: 4.5,
      count: 2,
      videoCount: 0,
      distribution: { '5': 1, '4': 1 },
      items: [review('a', 5), review('b', 4)],
    });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p.slug}`);
  }

  /**
   * Phần đo chung của hai ca thứ tự khối: sản phẩm từ 2 phân loại (có chip) và sản phẩm một phân loại (không chip). Trang đã mở ở 375px bằng `openPdp375`.
   */
  async function assertPdpBlockOrder(page: Page, hasChips: boolean, testInfo: TestInfo, shot: string): Promise<void> {
    await expect(page.locator('[data-section="pdp-reviews"]')).toBeVisible();

    // Thứ tự khối chung với Mini App (`PDP_BLOCK_ORDER` của app-core): khối nào sản phẩm này không có thì vắng, phần còn lại vẫn đúng thứ tự.
    const order = await page.locator('[data-pdp-block]').evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetHeight > 0).map((e) => ({ key: e.getAttribute('data-pdp-block')!, top: Math.round(e.getBoundingClientRect().top + window.scrollY) })),
    );
    const keys = order.map((b) => b.key);
    expect(keys).toEqual(PDP_BLOCK_ORDER.filter((k) => keys.includes(k)));
    expect(order.map((b) => b.top)).toEqual([...order.map((b) => b.top)].sort((a, b) => a - b));
    expect(keys).toEqual(expect.arrayContaining(['gallery', 'main', 'reviews', 'promises']));

    const blocks = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-section]'))
        .map((el) => ({ id: el.dataset.section!, ...el.getBoundingClientRect().toJSON() }))
        .filter((b) => b.height > 0)
        .map((b) => ({ id: b.id, top: Math.round(b.y + window.scrollY), bottom: Math.round(b.y + window.scrollY + b.height) }))
        .sort((a, b) => a.top - b.top || a.bottom - b.bottom),
    );
    const ids = blocks.map((b) => b.id);
    // Không còn dòng "Phân loại ›" (pdp-variation): chip đã đủ. Số lượng liền sau chip.
    expect(ids).toEqual(expect.arrayContaining(['pdp-main', 'pdp-quantity', 'pdp-reviews']));
    expect(ids).not.toContain('pdp-variation');
    if (hasChips) {
      expect(ids).toContain('pdp-variation-chips');
      expect(ids.indexOf('pdp-variation-chips') + 1).toBe(ids.indexOf('pdp-quantity'));
    } else {
      expect(ids).not.toContain('pdp-variation-chips');
    }

    // Từ Số lượng trở xuống mỗi khối là một dải trắng riêng cách dải trên đúng 8px (mt-2) trên nền canvas. Đo chính các dải (phần tử
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
      // Khối lợi ích (mô tả ngắn + chứng nhận) là dải riêng nhưng không có `data-section` ở vỏ.
      document
        .querySelectorAll<HTMLElement>('[data-section], [data-pdp-block="benefits"]')
        .forEach((el) => walk(el, el.dataset.section ?? 'pdp-benefits'));
      return found.sort((x, y) => x.top - y.top || x.bottom - y.bottom);
    });
    // Số lượng là dải riêng ngay dưới chip, cách đúng 8px như Mini App (hai hộp liền nhau, mt-2).
    const chipBand = bands.find((b) => b.id === 'pdp-variation-chips');
    const qtyBand = bands.find((b) => b.id === 'pdp-quantity');
    expect(qtyBand, 'Số lượng phải là dải nền surface').toBeTruthy();
    if (hasChips) {
      expect(chipBand, 'chip phải là dải nền surface').toBeTruthy();
      expect(qtyBand!.top - chipBand!.bottom).toBeGreaterThanOrEqual(7);
      expect(qtyBand!.top - chipBand!.bottom).toBeLessThanOrEqual(9);
    }
    // "Mua lại" và "Đặt định kỳ" là lối phụ nối liền dưới Số lượng trong cùng mảng trắng (Mini App cũng vậy): gộp vào dải Số lượng.
    const merged = bands.reduce<typeof bands>((acc, b) => {
      const prev = acc[acc.length - 1];
      if (prev && b.id === 'pdp-subscribe' && prev.id === 'pdp-quantity' && b.top - prev.bottom <= 1) {
        prev.bottom = Math.max(prev.bottom, b.bottom);
        return acc;
      }
      acc.push({ ...b });
      return acc;
    }, []);
    const bandFrom = merged.findIndex((b) => b.id === 'pdp-quantity');
    expect(bandFrom, 'dải Số lượng phải là dải nền surface').toBeGreaterThanOrEqual(0);
    expect(merged.some((b) => b.id === 'pdp-reviews')).toBe(true);
    for (let i = bandFrom + 1; i < merged.length; i++) {
      const gap = merged[i]!.top - merged[i - 1]!.bottom;
      expect(gap, `${merged[i - 1]!.id} -> ${merged[i]!.id}`).toBeGreaterThanOrEqual(7);
      expect(gap, `${merged[i - 1]!.id} -> ${merged[i]!.id}`).toBeLessThanOrEqual(9);
    }

    // Hàng chip lọc của khối đánh giá đầy đủ như Mini App.
    const chips = page.locator('[data-section="pdp-reviews"] button[aria-pressed]');
    await expect(chips.first()).toHaveText('Tất cả(2)');
    await expect(chips).toHaveText(['Tất cả(2)', '5 sao(1)', '4 sao(1)', '3 sao(0)', '2 sao(0)', '1 sao(0)', 'Có ảnh']);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath(shot), fullPage: true });
  }
  test('thứ tự khối ở 375px như Mini App: chip phân loại (từ 2 phân loại), Số lượng, rồi các khối theo PDP_BLOCK_ORDER; các dải trắng cách nhau tối đa 8px; không tràn ngang', async ({ page, api, request }, testInfo) => {
    const p = await multiVariationProduct(request);
    // Trên CI thiếu sản phẩm từ 2 phân loại thì đỏ, không skip (DB migration demo luôn có).
    assertProductOnCi(p, 'sản phẩm từ 2 phân loại');
    test.skip(!p, 'DB e2e chưa có sản phẩm nào từ 2 phân loại');
    await openPdp375(page, api, p!, () => 3);
    await assertPdpBlockOrder(page, true, testInfo, 'pdp-web375-order.png');
  });
  test('sản phẩm một phân loại ở 375px: không vẽ chip phân loại, Số lượng vẫn là dải riêng, thứ tự khối như Mini App', async ({ page, api, request }, testInfo) => {
    const p = await singleVariationProduct(request);
    assertProductOnCi(p, 'sản phẩm một phân loại');
    test.skip(!p, 'DB e2e chưa có sản phẩm nào chỉ một phân loại');
    expect(p!.variations).toHaveLength(1);
    await openPdp375(page, api, p!, () => 3);
    await assertPdpBlockOrder(page, false, testInfo, 'pdp-web375-single-variation.png');
    // Một phân loại thì không có gì để chọn: chip không có trong DOM (không chỉ ẩn), còn Số lượng và nút mua vẫn đủ.
    await expect(page.locator('[data-section="pdp-variation-chips"]')).toHaveCount(0);
    await expect(page.locator('[data-section="pdp-quantity"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tăng số lượng' })).toBeVisible();
  });
  test('chip phân loại hết hàng khoá như Mini App; "Chỉ còn 3 sản phẩm" nằm trong khối thông tin chính', async ({ page, api, request }) => {
    // Cần từ 2 phân loại để có chip hết hàng; ngoài CI DB không có thì skip kèm lý do, trên CI thì đỏ (assertProductOnCi).
    const p = await multiVariationProduct(request);
    assertProductOnCi(p, 'sản phẩm từ 2 phân loại');
    test.skip(!p, 'DB e2e chưa có sản phẩm nào từ 2 phân loại, không kiểm được chip hết hàng');
    // Phân loại đầu hết hàng, còn lại còn 3.
    await openPdp375(page, api, p!, (i) => (i === 0 ? 0 : 3));
    await expect(page.locator('[data-section="pdp-variation-chips"]')).toBeVisible();

    // "Chỉ còn N sản phẩm" nằm trong khối thông tin chính (dưới giá/Điểm Xanh) như Mini App, không trôi xuống dải Phân loại.
    const low = page.locator('[data-testid="pdp-low-stock"]');
    await expect(low).toHaveText('Chỉ còn 3 sản phẩm');
    const lowBox = (await low.boundingBox())!;
    const mainBox = (await page.locator('[data-section="pdp-main"]').boundingBox())!;
    expect(lowBox.y).toBeGreaterThanOrEqual(mainBox.y);
    expect(lowBox.y + lowBox.height).toBeLessThanOrEqual(mainBox.y + mainBox.height + 1);

    // Chip phân loại hết hàng khoá như chip của Mini App (không chọn được).
    const stockChips = page.locator('[data-section="pdp-variation-chips"] button[aria-pressed]');
    await expect(stockChips.first()).toBeDisabled();
    await expect(stockChips.nth(1)).toBeEnabled();
    await stockChips.first().click({ force: true });
    await expect(stockChips.first()).toHaveAttribute('aria-pressed', 'false');
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

plain.describe('PDP web: rào dữ liệu sản phẩm', () => {
  plain.beforeEach(({}, testInfo) => {
    plain.skip(testInfo.project.name !== 'Web Customer Mobile', 'hàm thuần: chạy một lần ở project Web Customer Mobile');
  });
  plain('assertProductOnCi: trên CI thiếu sản phẩm thì đỏ, ngoài CI để spec bỏ qua có lý do', () => {
    const p: PdpProduct = { slug: 'x', variations: [{ id: 'v', stock: 1 }] };
    expect(() => assertProductOnCi(null, 'sản phẩm một phân loại', { GITHUB_ACTIONS: 'true' })).toThrow(/sản phẩm một phân loại/);
    expect(() => assertProductOnCi(p, 'sản phẩm một phân loại', { GITHUB_ACTIONS: 'true' })).not.toThrow();
    expect(() => assertProductOnCi(null, 'sản phẩm một phân loại', {})).not.toThrow();
  });
});
