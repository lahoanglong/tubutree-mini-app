import type { Page } from '@playwright/test';
import { expect, publicConfig, test, type MockApi } from './support/mock-api';
import { catalogHandler, foldE2E, mockDiscovery } from './support/discovery-mocks';

/**
 * Tìm kiếm Mini App 360/393 (wave tubu-w2-05-search-autocomplete-and-category-ux): phần dính ≤ 104px và chỉ còn một hàng khi cuộn xuống,
 * kết quả rỗng có 4 lối, chip "Tìm phổ biến" một dòng, "Xoá tất cả". Cùng chức năng với bản web (search-ux.web.spec.ts). API mock toàn bộ.
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

function mockSearch(api: MockApi, opts: { chat?: boolean } = {}): void {
  mockDiscovery(api);
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
  api.get('/search/popular', { terms: POPULAR });
  if (opts.chat) api.get('/config/public', publicConfig({ chat: { enabled: true, hours: { start: '08:00', end: '21:00' } } }));
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

const scroller = (page: Page) => page.locator('.zaui-page').first();
const scrollBy = (page: Page, dy: number) => scroller(page).evaluate((el, d) => el.scrollBy(0, d), dy);

/** Đáy thấp nhất của các phần đang dính ở đầu màn; phần đã trượt khuất phía trên không tính. */
const stickyBottom = (page: Page) =>
  page.evaluate(() => {
    let bottom = 0;
    for (const el of document.querySelectorAll<HTMLElement>('.zaui-page *')) {
      if (getComputedStyle(el).position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top > 200 || r.height === 0) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    return Math.round(bottom);
  });

for (const size of [
  { width: 360, height: 780 },
  { width: 393, height: 852 },
]) {
  test.describe(`Tìm kiếm Mini — ${size.width}px`, () => {
    test.use({ viewport: size });

    test('tìm không ra (bộ lọc còn hàng loại hết món đã sửa): Ý bạn là, danh mục gần (bỏ danh mục 0 món), Bán chạy còn hàng, Nhắn Tubu; ghi search_zero_result', async ({ page, api }) => {
      mockSearch(api, { chat: true });
      await page.goto(`/browse?q=${encodeURIComponent(ZERO_Q)}&inStock=1`);
      const hint = page.getByRole('button', { name: 'Ý bạn là "nước giặt"?' });
      await expect(hint).toBeVisible({ timeout: 30_000 });
      const near = page.getByRole('group', { name: 'Thử danh mục' });
      await expect(near.getByRole('button', { name: 'Nước giặt' })).toBeVisible();
      await expect(near.getByRole('button', { name: 'Giặt tay' })).toHaveCount(0);
      const rail = page.getByRole('region', { name: 'Bán chạy còn hàng' });
      await expect(rail.getByRole('button').first()).toBeVisible();
      const chat = page.getByRole('button', { name: 'Chưa thấy món cần tìm? Nhắn Tubu' });
      await expect(chat).toBeVisible();
      const ys = await Promise.all([hint, near, rail, chat].map(async (l) => (await l.boundingBox())!.y));
      expect([...ys].sort((a, b) => a - b), 'thứ tự: Ý bạn là, danh mục, kệ bán chạy, nhắn Tubu').toEqual(ys);
      expect(api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') === '6')).toBe(true);
      await expect.poll(() => api.callsTo('POST', '/events').some((c) => JSON.stringify(c.body ?? '').includes('search_zero_result')), { timeout: 15_000 }).toBe(true);
      await shot(page, `${size.width}-mini-zero-result`);

      await hint.click();
      await expect(page).toHaveURL(/q=n%C6%B0%E1%BB%9Bc(\+|%20)gi%E1%BA%B7t/);
    });

    test('phần dính ≤ 104px; cuộn xuống chỉ còn hàng sắp xếp + Lọc, cuộn lên hiện lại ô tìm', async ({ page, api }) => {
      mockSearch(api);
      await page.goto('/browse?q=tui+vai');
      await expect(page.getByText('Túi Vải Canvas Tubu số 1', { exact: true })).toBeVisible({ timeout: 30_000 });
      const row = page.getByTestId('browse-search-row');
      await scrollBy(page, 120);
      expect(await stickyBottom(page), 'ô tìm + hàng sắp xếp').toBeLessThanOrEqual(104);
      await expect(row).not.toHaveAttribute('data-collapsed', 'true');

      await scrollBy(page, 700);
      await expect(row).toHaveAttribute('data-collapsed', 'true');
      await expect.poll(() => stickyBottom(page)).toBeLessThanOrEqual(64);
      await expect(page.getByRole('button', { name: /^Lọc/ }).first()).toBeInViewport();
      await shot(page, `${size.width}-mini-collapsed`);

      await scrollBy(page, -200);
      await expect(row).not.toHaveAttribute('data-collapsed', 'true');
    });

    test('ô trống: chip "Tìm phổ biến" một dòng cuộn ngang; từ 2 bộ lọc có "Xoá tất cả" giữ từ khoá', async ({ page, api }) => {
      mockSearch(api);
      await page.goto('/browse');
      await page.getByRole('searchbox').first().click({ timeout: 30_000 });
      const group = page.getByRole('group', { name: 'Tìm phổ biến' });
      await expect(group.getByRole('button').first()).toBeVisible();
      const row = group.locator('.scroll-x');
      const one = await row.evaluate((el) => {
        const tops = new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top)));
        return { lines: tops.size, scrolls: el.scrollWidth > el.clientWidth };
      });
      expect(one.lines, 'một dòng').toBe(1);
      expect(one.scrolls, '8 cụm tràn thì cuộn ngang, không xuống dòng').toBe(true);
      await shot(page, `${size.width}-mini-popular`);
      await group.getByRole('button', { name: 'cho bé' }).click();
      await expect(page).toHaveURL(/q=cho(\+|%20)b%C3%A9/);

      await page.goto('/browse?q=tui+vai&brand=Tubu&inStock=1');
      const clear = page.getByRole('group', { name: 'Đang lọc' }).getByRole('button', { name: 'Xoá tất cả' });
      await expect(clear).toBeVisible({ timeout: 30_000 });
      await clear.click();
      await expect(page).toHaveURL(/\/browse\?q=tui(\+|%20)vai$/);
    });
  });
}
