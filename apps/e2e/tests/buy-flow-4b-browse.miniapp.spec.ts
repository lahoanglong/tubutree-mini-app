import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { BINH_SUA, NRC, XA_PHONG, mockDiscovery } from './support/discovery-mocks';
import { eventsNamed, flushEvents } from './support/events';

/**
 * Zalo Mini App E2E — Dự án 4b "Khám phá & tìm kiếm" (spec §5), phần Danh mục / Tìm kiếm. API mock toàn bộ.
 * Chạy trên WebKit (iPhone 12) nên nút "x" gốc, vòng focus, vùng chạm 44px, cuộn của `.zaui-page` được kiểm
 * bằng trình duyệt thật. Không dùng page.waitForTimeout; assert "vắng mặt" chỉ sau khi đã thấy request + khung chờ biến mất.
 */

const SORT_GROUP = 'Sắp xếp';

/** Danh sách ở trạng thái CUỐI: đã gọi /products và khung chờ lưới biến mất. */
async function waitBrowseSettled(page: Page, api: MockApi): Promise<void> {
  await expect.poll(() => api.callsTo('GET', '/products').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0, { timeout: 15_000 });
}

/** Phần tử cuộn thật của trang Danh mục (`.zaui-page` chứa lưới). */
const scrollerOf = (page: Page): Locator => page.locator('.zaui-page', { has: page.getByTestId('catalog-grid') }).first();
const tilesOf = (page: Page): Locator => page.getByTestId('catalog-grid').locator('[role="button"][aria-label]');
const scrollTopOf = (loc: Locator): Promise<number> => loc.evaluate((el) => el.scrollTop);

/**
 * Chip nhìn cao 36px nhưng vùng chạm 44px (`.tubu-hit-44::after`). Điểm 3px NGOÀI mép trên/dưới của viên thuốc
 * vẫn phải trúng chính chip (không bị `.scroll-x` cắt); điểm 8px ngoài mép thì KHÔNG (đối chứng: phép đo không vô nghĩa).
 */
async function expectChipHitArea44(chip: Locator): Promise<void> {
  const box = (await chip.boundingBox())!;
  expect(box.height).toBeLessThan(44);
  const hit = await chip.evaluate(
    (el, b) => {
      const x = b.x + b.width / 2;
      const at = (y: number) => document.elementFromPoint(x, y)?.closest('button') === el;
      return { above3: at(b.y - 3), below3: at(b.y + b.height + 3), above8: at(b.y - 8), below8: at(b.y + b.height + 8), inside: at(b.y + b.height / 2) };
    },
    { x: box.x, y: box.y, width: box.width, height: box.height },
  );
  expect(hit).toEqual({ above3: true, below3: true, above8: false, below8: false, inside: true });
}

test.describe('Buy-flow 4b — Danh mục / Tìm kiếm', () => {
  test('Gợi ý khi gõ (không tải kết quả); Enter mới tìm; từ khoá vào "Tìm gần đây"', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?focus=search');
    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await expect(box).toBeFocused({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/browse$/); // ?focus=search dùng một lần rồi bỏ (replace)
    await waitBrowseSettled(page, api);

    const suggested = api.waitForCall('GET', '/search/suggest');
    await box.fill('nuoc rua');
    expect((await suggested).query.get('q')).toBe('nuoc rua');
    const sug = page.getByRole('region', { name: 'Gợi ý tìm kiếm' });
    await expect(sug.getByRole('button', { name: new RegExp(NRC.name) })).toBeVisible();
    await expect(sug.getByRole('button', { name: new RegExp(BINH_SUA.name) })).toBeVisible();
    // Gõ chỉ hiện gợi ý: chưa có request /products nào mang `q`, URL chưa có `q`.
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('q') !== null)).toBe(false);
    await expect(page).toHaveURL(/\/browse$/);

    const searched = api.waitForCall('GET', '/products');
    await box.press('Enter');
    expect((await searched).query.get('q')).toBe('nuoc rua');
    await expect(page).toHaveURL(/\/browse\?q=nuoc\+rua$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await expect(sug).toHaveCount(0);

    await box.click();
    await box.fill('');
    await expect(page.getByRole('group', { name: 'Tìm gần đây' }).getByRole('button', { name: 'nuoc rua' })).toBeVisible();
  });

  test('Vào thẳng /browse?q=… không bắn request gợi ý; gõ tiếp thì mới gợi ý', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?q=nuoc%20rua');
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await waitBrowseSettled(page, api);
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toHaveValue('nuoc rua');
    expect(api.callsTo('GET', '/search/suggest')).toEqual([]);
    await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toHaveCount(0);

    const suggested = api.waitForCall('GET', '/search/suggest');
    await page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).fill('xa phong');
    expect((await suggested).query.get('q')).toBe('xa phong');
    await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' }).getByRole('button', { name: new RegExp(XA_PHONG.name) })).toBeVisible();
  });

  test('Ô trống, chưa có lịch sử: bấm vào ô vẫn thấy Danh mục + sắp xếp; có chữ thì gợi ý thay nội dung', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await waitBrowseSettled(page, api);
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });

    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await box.click();
    await expect(box).toBeFocused();
    await expect(page.getByRole('button', { name: 'Hủy' })).toBeVisible(); // đã vào chế độ gõ
    await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toHaveCount(0);
    await expect(cats).toBeVisible();
    await expect(page.getByRole('group', { name: SORT_GROUP })).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm');

    await box.fill('nuoc');
    await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeVisible();
    await expect(cats).toHaveCount(0);
    await expect(page.getByRole('group', { name: SORT_GROUP })).toHaveCount(0);

    await page.getByRole('button', { name: 'Hủy' }).click();
    await expect(box).toHaveValue('');
    await expect(cats).toBeVisible();
  });

  test('Ô trống có lịch sử: hiện "Tìm gần đây"; chạm từ khoá tìm luôn; "Xoá lịch sử tìm" trả lại nội dung Danh mục', async ({ page, api }) => {
    await page.addInitScript(() => localStorage.setItem('tubu_recent_searches', JSON.stringify(['nuoc rua'])));
    mockDiscovery(api);
    await page.goto('/browse');
    await waitBrowseSettled(page, api);
    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await box.click();
    const recent = page.getByRole('group', { name: 'Tìm gần đây' });
    await expect(recent.getByRole('button', { name: 'nuoc rua' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Danh mục' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Xoá lịch sử tìm' }).click();
    await expect(recent).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tubu_recent_searches') ?? '[]'))).toEqual([]);
    await expect(page.getByRole('region', { name: 'Danh mục' })).toBeVisible(); // không còn gì để gợi ý → không trang trắng

    await page.evaluate(() => localStorage.setItem('tubu_recent_searches', JSON.stringify(['nuoc rua'])));
    await page.goto('/browse');
    await page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).click();
    const searched = api.waitForCall('GET', '/products');
    await page.getByRole('group', { name: 'Tìm gần đây' }).getByRole('button', { name: 'nuoc rua' }).click();
    expect((await searched).query.get('q')).toBe('nuoc rua');
    await expect(page).toHaveURL(/\/browse\?q=nuoc\+rua$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
  });

  test('Bộ lọc: giá + còn hàng + từ 4★ + thương hiệu → nút báo đúng số → áp dụng → URL, request, chip, filter_applied ×4; gỡ 4★ → thêm đúng 1', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Bộ lọc' }).click();
    for (const name of ['100k–200k', 'Chỉ hiện còn hàng', 'Từ 4★ trở lên', 'Tubu']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    const apply = page.getByRole('button', { name: 'Xem 1 sản phẩm' });
    await expect(apply).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('limit') === '1' && c.query.get('inStock') === 'true')).toBe(true);

    const listed = api.waitForCall('GET', '/products');
    await apply.click();
    expect(Object.fromEntries((await listed).query)).toMatchObject({
      brand: 'Tubu', minPrice: '100000', maxPrice: '200000', inStock: 'true', minRating: '4', limit: '30',
    });
    await expect(page).toHaveURL(/\/browse\?brand=Tubu&minPrice=100000&maxPrice=200000&inStock=1&rating=4$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Tubu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bộ lọc (4)' })).toBeVisible();

    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'filter_applied').length, { timeout: 15_000 }).toBe(4);
    expect(eventsNamed(api, 'filter_applied').map((e) => e.props.type).sort()).toEqual(['brand', 'in_stock', 'price', 'rating']);

    // Chỉ đổi MỘT loại (bỏ 4★) → thêm đúng một sự kiện `rating`, không bắn lại 3 loại không đổi.
    await page.getByRole('button', { name: 'Bộ lọc (4)' }).click();
    await page.getByRole('button', { name: 'Từ 4★ trở lên', exact: true }).click();
    const applyAgain = page.getByRole('button', { name: 'Xem 1 sản phẩm' });
    await expect(applyAgain).toBeVisible({ timeout: 15_000 });
    await applyAgain.click();
    await expect(page).toHaveURL(/\/browse\?brand=Tubu&minPrice=100000&maxPrice=200000&inStock=1$/, { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'filter_applied').length, { timeout: 15_000 }).toBe(5);
    expect(eventsNamed(api, 'filter_applied').map((e) => e.props.type).slice(4)).toEqual(['rating']);
  });

  test('Sắp xếp "Bán chạy" → URL sort=best_seller, request có sort, thứ tự theo số đã bán; "Gợi ý" bỏ sort', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    const sortGroup = page.getByRole('group', { name: SORT_GROUP });
    const sorted = api.waitForCall('GET', '/products');
    await sortGroup.getByRole('button', { name: 'Bán chạy' }).click();
    expect((await sorted).query.get('sort')).toBe('best_seller');
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/, { timeout: 15_000 });
    await expect(sortGroup.getByRole('button', { name: 'Bán chạy' })).toHaveAttribute('aria-pressed', 'true');
    await expect(tilesOf(page).nth(0)).toHaveAttribute('aria-label', XA_PHONG.name, { timeout: 15_000 });
    await expect(tilesOf(page).nth(1)).toHaveAttribute('aria-label', BINH_SUA.name);
    await expect(tilesOf(page).nth(2)).toHaveAttribute('aria-label', NRC.name);

    await sortGroup.getByRole('button', { name: 'Gợi ý' }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 });
    await expect(tilesOf(page).nth(0)).toHaveAttribute('aria-label', NRC.name, { timeout: 15_000 }); // thứ tự mặc định = thứ tự danh mục
  });

  test('Quay lại từ trang SP giữ sắp xếp/bộ lọc và KHÔI PHỤC vị trí cuộn; đổi sắp xếp không thêm mục lịch sử', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?segment=eco');
    await expect(page.getByTestId('result-count')).toHaveText('26 sản phẩm', { timeout: 15_000 });
    const historyBefore = await page.evaluate(() => history.length);
    const sortGroup = page.getByRole('group', { name: SORT_GROUP });
    await sortGroup.getByRole('button', { name: 'Bán chạy' }).click();
    await sortGroup.getByRole('button', { name: 'Giá giảm' }).click();
    await expect(page).toHaveURL(/\/browse\?segment=eco&sort=price_desc$/, { timeout: 15_000 });
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);

    const tile = page.getByRole('button', { name: 'Túi Vải Canvas Tubu số 12', exact: true });
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tile.scrollIntoViewIfNeeded();
    const y = await scrollTopOf(scrollerOf(page));
    expect(y).toBeGreaterThan(300); // đã cuộn thật, không phải 0
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('tubu_scroll:segment=eco&sort=price_desc')), { timeout: 5_000 })
      .toBe(String(Math.round(y)));

    await tile.click();
    await expect(page).toHaveURL(/\/product\/tui-vai-12$/, { timeout: 15_000 });
    await expect(page.getByText('Mô tả ngắn Túi Vải Canvas Tubu số 12')).toBeVisible({ timeout: 15_000 });
    await page.goBack();

    await expect(page).toHaveURL(/\/browse\?segment=eco&sort=price_desc$/, { timeout: 15_000 });
    await expect(sortGroup.getByRole('button', { name: 'Giá giảm' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Sống xanh' })).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveText('26 sản phẩm', { timeout: 15_000 });
    await expect(tile).toBeVisible();
    await expect.poll(async () => Math.abs((await scrollTopOf(scrollerOf(page))) - y), { timeout: 10_000 }).toBeLessThanOrEqual(4);
    await expect(tile).toBeInViewport(); // đúng chỗ cũ: thẻ vừa bấm đang nằm trong màn hình
  });

  test('Mở mới /browse bằng điều hướng thường (không phải Back) luôn bắt đầu từ đầu trang dù đã lưu vị trí cuộn', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const seeAll = page.getByRole('button', { name: 'Xem tất cả Bán chạy' });
    await seeAll.click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await waitBrowseSettled(page, api);

    await scrollerOf(page).evaluate((el) => { el.scrollTop = 900; });
    const y = await scrollTopOf(scrollerOf(page));
    expect(y).toBeGreaterThan(300);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tubu_scroll:sort=best_seller')), { timeout: 5_000 }).toBe(String(Math.round(y)));

    await page.goBack(); // về Trang chủ (rời Browse → vị trí được lưu)
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await seeAll.click({ timeout: 15_000 }); // PUSH tới CÙNG URL: không phải Back
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await expect(tilesOf(page).first()).toBeVisible();
    expect(Number(await page.evaluate(() => sessionStorage.getItem('tubu_scroll:sort=best_seller')))).toBeGreaterThan(300); // vị trí cũ VẪN còn lưu
    expect(await scrollTopOf(scrollerOf(page))).toBe(0);
  });

  test('Link cũ từ Trang chủ: ?segment=mom_baby và ?brand=Tubu thành chip gỡ được; tham số lạ (utm) được giữ', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?segment=mom_baby');
    const chip = page.getByRole('button', { name: 'Bỏ lọc Cho mẹ & bé' });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
    await chip.click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });

    await page.goto('/browse?brand=Tubu');
    await expect(page.getByRole('button', { name: 'Bỏ lọc Tubu' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('28 sản phẩm', { timeout: 15_000 });

    await page.goto('/browse?utm_source=zalo&inStock=1');
    await expect(page.getByRole('button', { name: 'Bỏ lọc Còn hàng' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Bỏ lọc Còn hàng' }).click();
    await expect(page).toHaveURL(/\/browse\?utm_source=zalo$/, { timeout: 15_000 });
  });

  test('Chọn danh mục thật ở trang gốc: đổi URL bằng replace, chip gỡ được, lưới danh mục ẩn; danh mục rỗng không hiện', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Cho bé' })).toBeVisible();
    await expect(cats.getByRole('button', { name: 'Cà phê & Đồ uống' })).toHaveCount(0); // productCount 0
    const historyBefore = await page.evaluate(() => history.length);
    await cats.getByRole('button', { name: 'Tẩy rửa sinh học' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-cleaning$/, { timeout: 15_000 });
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);
    await expect(page.getByRole('button', { name: 'Bỏ lọc Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
    await expect(cats).toHaveCount(0);
  });

  test('API cũ: bộ lọc mới bị 400 → tải lại không lọc + câu báo, không ErrorState; danh mục về 4 phân khúc', async ({ page, api }) => {
    mockDiscovery(api, { legacy: true });
    await page.goto('/browse?inStock=1');
    await expect(page.getByText(/Bộ lọc nâng cao chưa dùng được/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await waitBrowseSettled(page, api);
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const lists = api.callsTo('GET', '/products').filter((c) => c.query.get('limit') === '30');
    expect(lists).toHaveLength(2);
    expect(lists[0]!.query.get('inStock')).toBe('true'); // lần đầu có tham số mới → 400
    expect(lists[1]!.query.get('inStock')).toBeNull(); // lần thử lại không có tham số mới

    await page.goto('/browse');
    await expect.poll(() => api.callsTo('GET', '/categories').length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('category-grid-loading')).toHaveCount(0);
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Cho mẹ & bé' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toHaveCount(0);
    await expect(cats.getByRole('button')).toHaveCount(4); // đúng 4 phân khúc
  });

  test('Chạm kết quả khi đang tìm → search_result_clicked { q, position, source, slug }; search_performed có resultsCount', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?q=nuoc%20rua');
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await tilesOf(page).nth(1).click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_result_clicked').length, { timeout: 15_000 }).toBe(1);
    expect(eventsNamed(api, 'search_result_clicked')[0]!.props).toEqual({ q: 'nuoc rua', position: 2, source: 'results', slug: BINH_SUA.slug });
    expect(eventsNamed(api, 'search_performed').map((e) => e.props)).toEqual([{ q: 'nuoc rua', resultsCount: 2 }]);
  });

  test('Chạm gợi ý sản phẩm → search_result_clicked source "suggest" + vị trí; chạm SP khi KHÔNG tìm thì không bắn', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await waitBrowseSettled(page, api);
    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await box.click();
    await box.fill('nuoc rua');
    const sug = page.getByRole('region', { name: 'Gợi ý tìm kiếm' });
    await expect(sug.getByRole('button', { name: new RegExp(BINH_SUA.name) })).toBeVisible({ timeout: 15_000 });
    await sug.getByRole('button', { name: new RegExp(BINH_SUA.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/product/${BINH_SUA.slug}$`), { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_result_clicked').length, { timeout: 15_000 }).toBe(1);
    expect(eventsNamed(api, 'search_result_clicked')[0]!.props).toEqual({ q: 'nuoc rua', position: 2, source: 'suggest', slug: BINH_SUA.slug });

    // Trang gốc, không có `q`: chạm thẻ SP không phải là "kết quả tìm kiếm".
    await page.goBack();
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await tilesOf(page).first().click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => api.callsTo('POST', '/events').length, { timeout: 15_000 }).toBeGreaterThan(1);
    expect(eventsNamed(api, 'search_result_clicked')).toHaveLength(1);
  });

  test('search_performed: đúng một lần cho mỗi lần tìm đã chốt, KHÔNG bắn lại khi Back từ trang SP; từ khoá mới thì bắn', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?q=nuoc%20rua');
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_performed').length, { timeout: 15_000 }).toBe(1);

    await tilesOf(page).first().click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/browse\?q=nuoc(\+|%20)rua$/, { timeout: 15_000 }); // Back restores the raw URL
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await waitBrowseSettled(page, api);
    // Chờ chính lượt Back đã được ghi nhận bằng một sự kiện khác (search_result_clicked) rồi mới đếm.
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_result_clicked').length, { timeout: 15_000 }).toBe(1);
    expect(eventsNamed(api, 'search_performed').map((e) => e.props)).toEqual([{ q: 'nuoc rua', resultsCount: 2 }]);

    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await box.click();
    await box.fill('xa phong');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/browse\?q=xa\+phong$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_performed').length, { timeout: 15_000 }).toBe(2);
    expect(eventsNamed(api, 'search_performed').map((e) => e.props)).toEqual([
      { q: 'nuoc rua', resultsCount: 2 },
      { q: 'xa phong', resultsCount: 1 },
    ]);
  });

  test('Không có kết quả → EmptyState + "Đã xem gần đây"; "Xoá tìm kiếm & bộ lọc" giữ sắp xếp', async ({ page, api }) => {
    await page.addInitScript(() =>
      localStorage.setItem('tubu_recently_viewed', JSON.stringify([{ slug: 'xa-phong-thao-moc', name: 'Xà Phòng Thảo Mộc', thumbnail: null, price: 45000, viewedAt: 1 }])),
    );
    mockDiscovery(api);
    await page.goto('/browse?q=zzzz&sort=newest');
    await expect(page.getByText('Không tìm thấy "zzzz"')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Đã xem gần đây' }).getByRole('button', { name: 'Xà Phòng Thảo Mộc' })).toBeVisible();
    await page.getByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }).click();
    await expect(page).toHaveURL(/\/browse\?sort=newest$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
  });

  test('Vùng chạm Chip 44px không bị hàng cuộn ngang cắt (hàng sắp xếp và hàng chip đang lọc)', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?inStock=1');
    await expect(page.getByTestId('result-count')).toHaveText('29 sản phẩm', { timeout: 15_000 });
    await waitBrowseSettled(page, api);
    await expectChipHitArea44(page.getByRole('group', { name: SORT_GROUP }).getByRole('button', { name: 'Bán chạy' }));
    await expectChipHitArea44(page.getByRole('group', { name: 'Đang lọc' }).getByRole('button', { name: 'Bỏ lọc Còn hàng' }));
  });

  test.describe('Ô tìm kiếm trên trình duyệt thật', () => {
    test('Nút "x" gốc của trình duyệt bị ẩn (chỉ còn nút xoá của app); vòng focus hiện khi focus; xoá xong focus quay lại ô', async ({ page, api }) => {
      mockDiscovery(api);
      await page.goto('/browse');
      await waitBrowseSettled(page, api);
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      const frame = page.getByTestId('search-field-box');

      // Vòng focus: không focus → không đổ bóng; focus → bóng 2px (token --color-border-focus).
      await expect(frame).toHaveCSS('box-shadow', 'none');
      await box.focus();
      await expect(frame).not.toHaveCSS('box-shadow', 'none');
      expect(await frame.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/\b2px\b/);
      await box.blur();
      await expect(frame).toHaveCSS('box-shadow', 'none');

      // Nút "x" gốc của WebKit: so ảnh dải 40px bên phải ô nhập khi CÓ chữ với khi trống (ô trống không bao giờ có "x").
      // Giống nhau = không có "x" gốc. Đối chứng: cùng phép so trên một ô search trơn (ngoài form role=search) PHẢI khác.
      const stripAt = (b: { x: number; y: number; width: number; height: number }) =>
        page.screenshot({ clip: { x: b.x + b.width - 40, y: b.y + 4, width: 40, height: b.height - 8 } });
      await page.evaluate(() => {
        const control = document.createElement('input');
        control.type = 'search';
        control.id = 'e2e-native-search-control';
        control.style.cssText = 'position:fixed;left:8px;top:200px;width:240px;height:40px;z-index:99999;background:#fff';
        document.body.appendChild(control);
      });
      const control = page.locator('#e2e-native-search-control');
      await control.focus();
      const controlBox = (await control.boundingBox())!;
      const controlEmpty = await stripAt(controlBox);
      await control.fill('nuoc');
      const controlFilled = await stripAt(controlBox);
      expect(controlFilled.equals(controlEmpty), 'đối chứng: ô search trơn phải vẽ "x" gốc khi có chữ').toBe(false);

      // Ô nhập của app hẹp lại khi nút xoá của app xuất hiện: đo dải theo hình học lúc CÓ chữ rồi so với chính vùng đó lúc trống.
      await box.focus();
      await box.fill('nuoc');
      const appBox = (await box.boundingBox())!;
      const appFilled = await stripAt(appBox);
      await box.fill('');
      const appEmpty = await stripAt(appBox);
      expect(appFilled.equals(appEmpty), 'ô tìm của app không được vẽ "x" gốc').toBe(true);
      await box.fill('nuoc');
      await expect(page.getByRole('button', { name: 'Xoá từ khoá' })).toHaveCount(1); // một nút xoá duy nhất

      await box.blur();
      await page.getByRole('button', { name: 'Xoá từ khoá' }).click();
      await expect(box).toHaveValue('');
      await expect(box).toBeFocused();
      await expect(page.getByRole('button', { name: 'Xoá từ khoá' })).toHaveCount(0);
    });

    test('Enter khi bộ gõ đang ghép chữ (isComposing / keyCode 229) bị chặn; Enter thường thì không', async ({ page, api }) => {
      mockDiscovery(api);
      await page.goto('/browse');
      await waitBrowseSettled(page, api);
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      await box.fill('nuoc');
      // WebKit của Playwright không có CDP `Input.imeSetComposition` và `keyboard.press` không sinh phiên ghép
      // chữ, nên bắn sự kiện tổng hợp tới đúng handler React. Sự kiện không đáng tin cậy không tự gửi form →
      // điều kiện kiểm được là `defaultPrevented` (chính thứ ngăn Safari/WKWebView gửi form ngầm).
      const prevented = await box.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        const enter = (init: KeyboardEventInit) => {
          const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
          el.dispatchEvent(ev);
          return ev.defaultPrevented;
        };
        const out = { composing: enter({ isComposing: true }), keyCode229: enter({ keyCode: 229 }), plain: enter({}) };
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'nuoc' }));
        return out;
      });
      expect(prevented).toEqual({ composing: true, keyCode229: true, plain: false });
      expect(api.callsTo('GET', '/products').some((c) => c.query.get('q') !== null)).toBe(false);
      await expect(page).toHaveURL(/\/browse$/);

      // Sau khi ghép xong, Enter thật vẫn tìm bình thường.
      const searched = api.waitForCall('GET', '/products');
      await box.press('Enter');
      expect((await searched).query.get('q')).toBe('nuoc');
    });
  });

  for (const width of [320, 375, 390]) {
    test(`Bố cục ở ${width}px: không tràn ngang, ô tìm/Bộ lọc/giỏ nằm trong màn hình, nút áp dụng của bộ lọc nhìn thấy`, async ({ page, api }, testInfo) => {
      await page.setViewportSize({ width, height: 780 });
      mockDiscovery(api);
      await page.goto('/browse?inStock=1&sort=best_seller');
      await expect(page.getByTestId('result-count')).toHaveText('29 sản phẩm', { timeout: 15_000 });
      await waitBrowseSettled(page, api);

      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector('.zaui-page') as HTMLElement;
        return { doc: document.documentElement.scrollWidth - window.innerWidth, page: scroller.scrollWidth - scroller.clientWidth };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.page).toBeLessThanOrEqual(0);
      for (const target of [page.getByRole('searchbox', { name: 'Tìm sản phẩm' }), page.getByRole('button', { name: 'Bộ lọc (1)' }), page.getByRole('button', { name: /Giỏ hàng|giỏ/i }).first()]) {
        const b = (await target.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
      await testInfo.attach(`browse-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });

      await page.getByRole('button', { name: 'Bộ lọc (1)' }).click();
      const apply = page.getByRole('button', { name: /^Xem [\d.]+ sản phẩm$/ });
      await expect(apply).toBeVisible({ timeout: 15_000 });
      await expect(apply).toBeInViewport();
      await testInfo.attach(`browse-filter-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
});
