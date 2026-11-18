import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG, catalogHandler, foldE2E } from './support/discovery-mocks';
import { refetchStale } from './support/refetch-stale';

/**
 * Tìm kiếm web (wave tubu-w2-05-search-autocomplete-and-category-ux): hộp gợi ý ở thanh đầu 1440 (bàn phím, chuột, Esc, không dịch bố cục),
 * cột lọc dính 1440, và ở khổ điện thoại 360/390: phần dính ≤ 104px, một hàng khi cuộn xuống, kết quả rỗng có 4 lối, chip phổ biến một dòng,
 * "Xoá tất cả". API mock ở trình duyệt; hai cờ mới mặc định tắt nên các trường `corrected`/`didYouMean`/`terms` đều do mock trả.
 * SEARCH_SHOTS=<thư mục> thì chụp ảnh.
 */
const SHOTS = process.env.SEARCH_SHOTS;
const ZERO_Q = 'nuoc giat zz';
const POPULAR = ['nước rửa chén', 'túi vải', 'cho bé', 'kem dưỡng', 'xà phòng', 'bình sữa', 'cà phê', 'đông trùng hạ thảo'];
const CATEGORIES = [
  { id: 'cat-giat', parentId: null, name: 'Nước giặt', slug: 'nuoc-giat', image: null, sortOrder: 1, productCount: 5 },
  { id: 'cat-giat-tay', parentId: null, name: 'Giặt tay', slug: 'giat-tay', image: null, sortOrder: 2, productCount: 0 },
  { id: 'cat-cleaning', parentId: null, name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', image: null, sortOrder: 3, productCount: 4 },
];
const suggestion = (x: (typeof CATALOG)[number]) => ({ slug: x.slug, name: x.name, thumbnail: x.thumbnail, basePrice: x.basePrice });

function mockSearch(api: MockApi, opts: { chat?: boolean } = {}): void {
  const base = catalogHandler();
  api.get('/products', (ctx) => {
    const q = ctx.call.query.get('q');
    // API chỉ trả "Ý bạn là" khi bước chịu gõ sai có tìm ra hàng nhưng bộ lọc (ở đây: còn hàng) loại hết; tìm trơn không ra thì không có gợi ý.
    if (q && foldE2E(q) === ZERO_Q) {
      const empty = { data: [], meta: { page: 1, limit: 20, total: 0 } };
      return ctx.call.query.get('inStock') === 'true' ? { ...empty, corrected: true, didYouMean: 'nước giặt' } : empty;
    }
    return base(ctx);
  });
  api.get('/categories', CATEGORIES);
  api.get('/brands', [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }]);
  api.get('/flash-sales/active', []);
  api.get('/search/popular', { terms: POPULAR });
  api.get('/search/suggest', ({ call }) => {
    const f = foldE2E(call.query.get('q') ?? '');
    const items = CATALOG.filter((x) => foldE2E(x.name).includes(f)).slice(0, 5).map(suggestion);
    return call.query.get('meta') === '1' ? { items, corrected: false, didYouMean: null } : items;
  });
  if (opts.chat) api.get('/config/public', { freeshipThreshold: 199_000, chat: { enabled: true } });
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /products/best-sellers', 'GET /me/coupons', 'GET /me/wishlist/ids', 'GET /cart', 'GET /products/for-you');
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

/** Đáy thấp nhất của các phần đang dính ở đầu màn (ô tìm, hàng sắp xếp); phần đã trượt khuất phía trên không tính. */
const stickyBottom = (page: Page) =>
  page.evaluate(() => {
    let bottom = 0;
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      if (getComputedStyle(el).position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top > 200 || r.height === 0) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    return Math.round(bottom);
  });

test.describe('Tìm kiếm web — 1440', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'thanh đầu có ô tìm từ md; đo ở 1440');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('hộp gợi ý thanh đầu: chip phổ biến khi ô trống, ↓/Enter bằng bàn phím, Esc giữ tiêu điểm, chuột chọn danh mục, không dịch bố cục', async ({ page, api }) => {
    mockSearch(api);
    await page.goto('/san-pham?q=xa+phong');
    await refetchStale(page, api, 'GET', '/products');
    const box = page.getByRole('combobox', { name: 'Tìm sản phẩm' });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    const before = await page.locator('main').boundingBox();

    await box.fill('');
    await box.blur();
    await box.focus();
    const listbox = page.getByRole('listbox', { name: 'Gợi ý tìm kiếm' });
    await expect(listbox.getByRole('group', { name: 'Tìm phổ biến' })).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await expect(box).toHaveAttribute('aria-controls', 'site-search-listbox');

    await box.fill('tui vai');
    await expect(listbox.getByRole('option', { name: /Túi Vải Canvas Tubu số 1\b/ })).toBeVisible();
    expect(await page.locator('main').boundingBox(), 'mở hộp không đẩy nội dung trang').toEqual(before);
    await shot(page, '1440-header-suggest');

    await box.press('ArrowDown');
    const first = listbox.getByRole('option').first();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
    await box.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('aria-expanded', 'false');

    await box.press('ArrowDown');
    await expect(listbox.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/san-pham\?q=tui(\+|%20)vai$/);

    await box.fill('giat');
    const cat = page.getByRole('listbox').getByRole('group', { name: 'Danh mục' }).getByRole('option', { name: 'Nước giặt' });
    await expect(cat).toBeVisible();
    await expect(page.getByRole('listbox').getByRole('option', { name: 'Giặt tay' }), 'danh mục 0 món không hiện').toHaveCount(0);
    await cat.hover();
    await expect(cat).toHaveAttribute('aria-selected', 'true');
    await cat.click();
    await expect(page).toHaveURL(/\/san-pham\?category=cat-giat$/);
  });

  test('API đã sửa từ khoá: nhóm sản phẩm của hộp gợi ý ghi "Đang hiện kết quả cho …"', async ({ page, api }) => {
    mockSearch(api);
    api.get('/search/suggest', ({ call }) => ({ items: CATALOG.slice(4, 7).map(suggestion), corrected: call.query.get('meta') === '1', didYouMean: 'túi vải' }));
    await page.goto('/san-pham?q=xa+phong');
    await refetchStale(page, api, 'GET', '/products');
    const box = page.getByRole('combobox', { name: 'Tìm sản phẩm' });
    await box.fill('tui vaj');
    await expect(page.getByRole('listbox').getByRole('group', { name: 'Đang hiện kết quả cho "túi vải"' })).toBeVisible();
  });

  test('cột lọc dính khi cuộn, không cao quá khung nhìn và tự cuộn bên trong', async ({ page, api }) => {
    mockSearch(api);
    await page.goto('/san-pham?q=tui+vai');
    await refetchStale(page, api, 'GET', '/products');
    const aside = page.getByTestId('filter-sidebar');
    await expect(aside).toBeVisible();
    // Cuộn tới giữa lưới: cột dính chỉ trong khung lưới, cuộn quá đáy lưới thì cột đi theo khung (đúng `position: sticky`).
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(() => window.scrollY > 300);
    const r = (await aside.boundingBox())!;
    const header = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().bottom ?? 0);
    expect(r.y, 'cột lọc dính ngay dưới thanh đầu').toBeGreaterThanOrEqual(header);
    expect(r.y).toBeLessThanOrEqual(header + 24);
    expect(r.y + r.height, 'không cao quá khung nhìn').toBeLessThanOrEqual(900);
    expect(await aside.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    await shot(page, '1440-filter-sidebar-sticky');
  });
});

for (const width of [360, 390]) {
  test.describe(`Tìm kiếm web — ${width}px`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại đo ở project Mobile');
      await page.setViewportSize({ width, height: 800 });
    });

    test('tìm không ra: tìm trơn không có Ý bạn là; có bộ lọc còn hàng thì Ý bạn là, danh mục gần (bỏ danh mục 0 món), Bán chạy còn hàng, Nhắn Tubu; ghi search_zero_result', async ({ page, api }) => {
      mockSearch(api, { chat: true });
      await page.goto(`/san-pham?q=${encodeURIComponent(ZERO_Q)}`);
      await refetchStale(page, api, 'GET', '/products');
      const paths = page.getByTestId('zero-result-paths');
      await expect(paths.getByRole('group', { name: 'Thử danh mục' })).toBeVisible();
      await expect(paths.getByRole('button', { name: /^Ý bạn là/ }), 'tìm trơn không ra: API không có gợi ý').toHaveCount(0);

      await page.goto(`/san-pham?q=${encodeURIComponent(ZERO_Q)}&inStock=1`);
      await refetchStale(page, api, 'GET', '/products');
      await expect(paths.getByRole('button', { name: 'Ý bạn là "nước giặt"?' })).toBeVisible();
      const near = paths.getByRole('group', { name: 'Thử danh mục' });
      await expect(near.getByRole('button', { name: 'Nước giặt' })).toBeVisible();
      await expect(near.getByRole('button', { name: 'Giặt tay' })).toHaveCount(0);
      const rail = paths.getByRole('region', { name: 'Bán chạy còn hàng' });
      await expect(rail.getByRole('link').first()).toBeVisible();
      await expect(paths.getByRole('link', { name: 'Chưa thấy món cần tìm? Nhắn Tubu' })).toBeVisible();
      const order = await paths.evaluate((el) =>
        [...el.children].map((c) => (c.matches('[role="group"]') ? 'categories' : c.matches('section') ? 'bestSellers' : c.textContent?.startsWith('Ý bạn là') ? 'didYouMean' : 'chat')),
      );
      expect(order).toEqual(['didYouMean', 'categories', 'bestSellers', 'chat']);
      expect(api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') === '6')).toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'không cuộn ngang').toBeLessThanOrEqual(0);
      // Sự kiện web gom lô tới /events/web, gửi mỗi 5 giây.
      await expect.poll(() => api.callsTo('POST', '/events/web').some((c) => JSON.stringify(c.body ?? '').includes('search_zero_result')), { timeout: 15_000 }).toBe(true);
      await shot(page, `${width}-web-zero-result`);

      await paths.getByRole('button', { name: 'Ý bạn là "nước giặt"?' }).click();
      await expect(page).toHaveURL(/q=n%C6%B0%E1%BB%9Bc(\+|%20)gi%E1%BA%B7t/);
    });

    test('phần dính ≤ 104px; cuộn xuống chỉ còn hàng sắp xếp + Lọc, cuộn lên hiện lại ô tìm; không đổi chiều cao luồng', async ({ page, api }) => {
      mockSearch(api);
      await page.goto('/san-pham?q=tui+vai');
      await refetchStale(page, api, 'GET', '/products');
      await expect(page.getByText('Túi Vải Canvas Tubu số 1', { exact: true })).toBeVisible();
      const row = page.getByTestId('browse-search-row');
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => window.scrollY >= 100);
      expect(await stickyBottom(page), 'ô tìm + hàng sắp xếp').toBeLessThanOrEqual(104);
      await expect(row).not.toHaveAttribute('data-collapsed', 'true');
      const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);

      await page.mouse.wheel(0, 700);
      await expect(row).toHaveAttribute('data-collapsed', 'true');
      await expect.poll(() => stickyBottom(page)).toBeLessThanOrEqual(56);
      expect(await page.evaluate(() => document.documentElement.scrollHeight), 'thu gọn bằng transform, không đổi chiều cao trang').toBe(docHeight);
      await expect(page.getByRole('button', { name: 'Lọc', exact: true })).toBeInViewport();
      await shot(page, `${width}-web-collapsed`);

      await page.mouse.wheel(0, -200);
      await expect(row).not.toHaveAttribute('data-collapsed', 'true');
    });

    test('ô trống: chip "Tìm phổ biến" một dòng cuộn ngang; từ 2 bộ lọc có "Xoá tất cả" giữ từ khoá', async ({ page, api }) => {
      mockSearch(api);
      await page.goto('/san-pham?focus=search');
      const popular = page.getByTestId('popular-searches');
      await expect(popular.getByRole('button').first()).toBeVisible();
      const one = await popular.evaluate((el) => {
        const tops = new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top)));
        return { lines: tops.size, scrolls: el.scrollWidth > el.clientWidth };
      });
      expect(one.lines, 'một dòng').toBe(1);
      expect(one.scrolls, '8 cụm tràn thì cuộn ngang, không xuống dòng').toBe(true);
      await shot(page, `${width}-web-popular`);
      await popular.getByRole('button', { name: 'cho bé' }).click();
      await expect(page).toHaveURL(/q=cho(\+|%20)b%C3%A9/);

      await page.goto('/san-pham?q=tui+vai&brand=Tubu&inStock=1');
      await refetchStale(page, api, 'GET', '/products');
      const clear = page.getByRole('group', { name: 'Đang lọc' }).getByRole('button', { name: 'Xoá tất cả' });
      await expect(clear).toBeVisible();
      await clear.click();
      await expect(page).toHaveURL(/\/san-pham\?q=tui(\+|%20)vai$/);
    });
  });
}
