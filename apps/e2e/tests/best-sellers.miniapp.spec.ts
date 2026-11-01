import type { Locator, Page } from '@playwright/test';
import { test, expect, reply } from './support/mock-api';
import { BINH_SUA, CATEGORY_TREE, XA_PHONG, mockDiscovery } from './support/discovery-mocks';
import { expectChipHitArea44 } from './support/hit-area';

/**
 * Trang Bán chạy nhất (/best-sellers) ở Mini App, 375px: tab danh mục tầng 1 + "Tất cả", thẻ hạng #1..#n theo vị trí thật, 20 món mỗi lần,
 * "Xem thêm" đánh hạng tiếp nối, khách chưa đăng nhập vẫn xem được, cây danh mục rỗng (như PROD) chỉ còn "Tất cả". API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const TABS_LABEL = 'Danh mục bán chạy';
const tablist = (page: Page): Locator => page.getByRole('tablist', { name: TABS_LABEL });
const grid = (page: Page): Locator => page.getByTestId('catalog-grid');
const ranks = (page: Page): Locator => grid(page).locator('[data-ds-part="rank"]');
const scrollerOf = (page: Page): Locator => page.locator('.zaui-page', { has: page.getByTestId('catalog-grid') }).first();
const productQueries = (calls: { query: URLSearchParams }[]) => calls.map((c) => Object.fromEntries(c.query.entries()));

test.describe('Bán chạy nhất — trang xếp hạng', () => {
  test('mở thẳng: tab "Tất cả" đang chọn cùng các danh mục gốc có hàng, 20 thẻ hạng #1..#20, xin đúng sort 30 ngày', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    await page.goto('/best-sellers');
    await expect(page.getByRole('heading', { level: 1, name: 'Bán chạy nhất' })).toBeVisible({ timeout: 15_000 });
    await expect(tablist(page).getByRole('tab')).toHaveText(['Tất cả', 'Chăm sóc da', 'Tẩy rửa sinh học', 'Cho bé'], { timeout: 15_000 });
    await expect(tablist(page).getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
    await expect(ranks(page).first()).toHaveText('#1');
    await expect(ranks(page).nth(19)).toHaveText('#20');
    await expect(grid(page).getByRole('button').first()).toHaveAccessibleName(new RegExp(XA_PHONG.name));

    const listCalls = productQueries(api.callsTo('GET', '/products'));
    expect(listCalls).toEqual([{ sort: 'best_seller_30d', limit: '20', page: '1' }]);
  });

  test('cây danh mục chưa về: ?category= không mang tên "Tất cả"; cây về thì mang tên danh mục', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    // Giữ cây danh mục tới khi test nhả: không dựa vào độ trễ cố định (khẳng định có thử lại sẽ đợi qua cả lúc cây về).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    api.get('/categories', async () => {
      await held;
      return CATEGORY_TREE;
    });
    await page.goto('/best-sellers?category=cat-baby');
    await expect(grid(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-label', 'Bán chạy nhất');
    release();
    await expect(page.getByRole('tabpanel', { name: 'Cho bé' })).toBeVisible({ timeout: 15_000 });
    await expect(tablist(page).getByRole('tab', { name: 'Cho bé' })).toHaveAttribute('aria-selected', 'true');
  });

  test('chạm tab danh mục: URL ?category=, hạng đánh lại từ #1 trong danh mục; "Tất cả" trả về bảng chung', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    await page.goto('/best-sellers');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });

    await tablist(page).getByRole('tab', { name: 'Cho bé' }).click();
    await expect(page).toHaveURL(/\/best-sellers\?category=cat-baby$/, { timeout: 15_000 });
    await expect(tablist(page).getByRole('tab', { name: 'Cho bé' })).toHaveAttribute('aria-selected', 'true');
    await expect(ranks(page)).toHaveText(['#1'], { timeout: 15_000 });
    await expect(grid(page).getByRole('button').first()).toHaveAccessibleName(new RegExp(BINH_SUA.name));
    await expect(page.getByRole('tabpanel', { name: 'Cho bé' })).toBeVisible();
    const last = api.callsTo('GET', '/products').at(-1)!;
    expect(Object.fromEntries(last.query.entries())).toEqual({ sort: 'best_seller_30d', limit: '20', page: '1', category: 'cat-baby' });

    await tablist(page).getByRole('tab', { name: 'Tất cả' }).click();
    await expect(page).toHaveURL(/\/best-sellers$/, { timeout: 15_000 });
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
  });

  test('"Xem thêm" tải 10 món còn lại: hạng tiếp nối #21..#30, nút biến mất; Back từ trang sản phẩm về đúng chỗ đã cuộn', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/best-sellers');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Xem thêm' }).click();
    await expect(ranks(page)).toHaveCount(30, { timeout: 15_000 });
    await expect(ranks(page).nth(20)).toHaveText('#21');
    await expect(ranks(page).nth(29)).toHaveText('#30');
    await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
    expect(productQueries(api.callsTo('GET', '/products')).map((q) => q.page)).toEqual(['1', '2']);

    // Cuộn tới đúng thẻ định chạm trước (chạm sẽ tự cuộn tới nó), rồi mới đo vị trí cần được khôi phục.
    const deep = grid(page).locator('button.tubu-tile-link').nth(24);
    await deep.scrollIntoViewIfNeeded();
    const y = await scrollerOf(page).evaluate((el) => el.scrollTop);
    expect(y).toBeGreaterThan(300);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tubu_scroll:best-sellers:all')), { timeout: 5_000 }).toBe(String(Math.round(y)));
    await deep.click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/best-sellers$/, { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await scrollerOf(page).evaluate((el) => el.scrollTop)) - y), { timeout: 10_000 }).toBeLessThanOrEqual(4);
  });

  test('cây danh mục rỗng (như PROD): chỉ còn tab "Tất cả" và danh sách vẫn đủ 20 thẻ', async ({ page, api }) => {
    mockDiscovery(api, { emptyCategories: true });
    await page.goto('/best-sellers');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
    await expect(tablist(page).getByRole('tab')).toHaveText(['Tất cả']);
    await expect(tablist(page).getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('khách chưa đăng nhập (mọi /auth/* và /me trả 401): vẫn xem được bảng xếp hạng, không có lời gọi cần đăng nhập', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    for (const path of ['/auth/guest', '/auth/zalo-mini-app', '/auth/refresh']) api.post(path, () => reply(401, { statusCode: 401, message: 'Unauthorized' }));
    api.get('/me', () => reply(401, { statusCode: 401, message: 'Unauthorized' }));
    await page.goto('/best-sellers');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
    await expect(tablist(page).getByRole('tab', { name: 'Cho bé' })).toBeVisible();
    await expect(page).toHaveURL(/\/best-sellers$/);
    expect(api.callsTo('GET', '/products').length).toBeGreaterThan(0);
  });

  test('vùng chạm: tab cao ≥ 36 và vùng chạm 44px; cuộn sâu thì thanh tab dính ngay dưới thanh Back, không bị che', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    await page.goto('/best-sellers');
    await expect(ranks(page)).toHaveCount(20, { timeout: 15_000 });
    await expectChipHitArea44(tablist(page).getByRole('tab', { name: 'Tất cả' }));

    await scrollerOf(page).evaluate((el) => { el.scrollTop = 800; });
    await expect(tablist(page)).toBeInViewport();
    // Thanh dính nằm ngay dưới thanh Back cố định (vùng an toàn + 56px): cao hơn mức đó là chui dưới thanh Back, thấp hơn là trôi khỏi chỗ dính.
    const bar = (await tablist(page).locator('..').boundingBox())!;
    expect(bar.y, 'thanh tab dính dưới thanh Back, không chui dưới nó').toBeGreaterThanOrEqual(55);
    expect(bar.y, 'và sát thanh Back, không để hở dải nội dung giữa hai thanh').toBeLessThanOrEqual(58);
    const hit = await tablist(page).getByRole('tab', { name: 'Tất cả' }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[role="tab"]') === el;
    });
    expect(hit, 'tab dính vẫn chạm được (không bị lớp khác phủ lên)').toBe(true);
  });
});
