import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { BINH_SUA, SHIPPING_CODE, SUBSCRIPTION_DAY_MONTH, XA_PHONG, mockDiscovery, toCard } from './support/discovery-mocks';
import { eventsNamed, flushEvents } from './support/events';

/**
 * Zalo Mini App E2E — Dự án 4b "Khám phá & tìm kiếm" (spec §5), phần Trang chủ. API mock toàn bộ.
 * Không dùng page.waitForTimeout; assert "vắng mặt" chỉ sau khi đã thấy request + khung chờ biến mất.
 */

/** Các khối Trang chủ CÓ nội dung (cao > 0), theo thứ tự DOM. */
async function visibleBlocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.homeBlock!),
  );
}

/** Trang chủ ở trạng thái CUỐI: purchased-items + categories đã trả lời, mọi khung chờ đã biến mất. */
async function waitHomeSettled(page: Page, api: MockApi): Promise<void> {
  await expect.poll(() => api.callsTo('GET', '/me/purchased-items').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => api.callsTo('GET', '/categories').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
  await expect(page.getByTestId('category-grid-loading')).toHaveCount(0);
  await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('order-strip-loading')).toHaveCount(0);
}

test.describe('Buy-flow 4b — Trang chủ', () => {
  test('Khách cũ: tìm → Mua lại → dải đơn → Dành cho bạn → Bán chạy → Danh mục; lưới SP đầu tiên trong 5 khối đầu', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true, forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Đơn của bạn' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toBeVisible();
    await waitHomeSettled(page, api);

    const blocks = await visibleBlocks(page);
    expect(blocks.slice(0, 6)).toEqual(['search', 'purchased', 'orderStrip', 'forYou', 'bestSellers', 'categories']);
    const firstGrid = blocks.findIndex((b) => ['forYou', 'bestSellers', 'featured', 'newArrivals'].includes(b)) + 1;
    expect(firstGrid).toBeLessThanOrEqual(5);
  });

  test('Khách mới: không kệ Mua lại / dải đơn; Bán chạy (theo số đã bán) và Danh mục đứng trước Dành cho bạn', async ({ page, api }) => {
    mockDiscovery(api, { forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toBeVisible();
    await waitHomeSettled(page, api);
    // Dải đơn: badge = 0 nên không gọi danh sách đơn; đợi /me/subscriptions (rỗng) đã trả lời rồi mới kết luận "vắng".
    await expect.poll(() => api.callsTo('GET', '/me/subscriptions').length, { timeout: 15_000 }).toBeGreaterThan(0);

    expect((await visibleBlocks(page)).slice(0, 4)).toEqual(['search', 'bestSellers', 'categories', 'forYou']);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Đơn của bạn' })).toHaveCount(0);
    expect(api.callsTo('GET', '/orders').filter((c) => c.query.get('status') === 'SHIPPING')).toEqual([]);
    // Lưới chứa SP đầu tiên = bán chạy nhất (XA_PHONG 120 > BINH_SUA 80 > NRC 50 > KEM 10).
    await expect(best.getByTestId('catalog-grid').getByRole('button').first()).toHaveAccessibleName(new RegExp(XA_PHONG.name));
    await expect
      .poll(() => api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') === '6'), { timeout: 15_000 })
      .toBe(true);
  });

  test('Danh mục thật chỉ hiện mục có hàng; chạm "Cho bé" → /browse?category=cat-baby, có chip gỡ được', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Cà phê & Đồ uống' })).toHaveCount(0);
    await cats.getByRole('button', { name: 'Cho bé' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-baby$/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Cho bé' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
  });

  test('A2-33: không còn "Khám phá vườn"; thẻ AI/Mua chung nằm dưới các lưới SP; "Tìm sản phẩm" mở ô tìm đã focus', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const newest = page.getByRole('region', { name: 'Mới về vườn' });
    await expect(newest).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    await expect(page.getByText('Khám phá vườn')).toHaveCount(0);
    const [newestBox, aiBox] = await Promise.all([newest.boundingBox(), page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox()]);
    expect(aiBox!.y).toBeGreaterThan(newestBox!.y);

    await page.getByRole('button', { name: 'Tìm sản phẩm' }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 }); // ?focus=search đã được dùng rồi bỏ
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeFocused();
  });

  test('Dải đơn: "Đơn … đang giao" mở chi tiết đơn; "Kỳ định kỳ kế tiếp" mở tab Định kỳ', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true });
    await page.goto('/');
    const strip = page.getByRole('region', { name: 'Đơn của bạn' });
    await expect(strip.getByRole('button', { name: new RegExp(`Kỳ định kỳ kế tiếp: ${SUBSCRIPTION_DAY_MONTH}`) })).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => api.callsTo('GET', '/orders').some((c) => c.query.get('status') === 'SHIPPING' && c.query.get('limit') === '1'), { timeout: 15_000 })
      .toBe(true);
    await strip.getByRole('button', { name: new RegExp(`Đơn ${SHIPPING_CODE} đang giao`) }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${SHIPPING_CODE}$`), { timeout: 15_000 });
  });

  test('Dải đơn: chạm "Kỳ định kỳ kế tiếp" mở tab Định kỳ của Đơn hàng', async ({ page, api }) => {
    mockDiscovery(api, { subscription: true });
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`Kỳ định kỳ kế tiếp: ${SUBSCRIPTION_DAY_MONTH}`) }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 15_000 });
    await expect(page.getByText('Nước Xả Vải Tubu').first()).toBeVisible({ timeout: 15_000 });
  });

  test('"Xem tất cả" của Bán chạy mở /browse?sort=best_seller, trang Danh mục xin đúng sắp xếp', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    await page.getByRole('button', { name: 'Xem tất cả Bán chạy' }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/, { timeout: 15_000 });
    await expect
      .poll(() => api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') !== '6'), { timeout: 15_000 })
      .toBe(true);
    await expect(page.getByTestId('catalog-grid').getByRole('button').first()).toHaveAccessibleName(new RegExp(XA_PHONG.name), { timeout: 15_000 });
  });

  test('Khách cũ đã được nhớ: thứ tự khối đúng ngay khi purchased-items còn chưa trả lời, và không xếp lại sau đó', async ({ page, api }) => {
    mockDiscovery(api, { forYou: [toCard(BINH_SUA)] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.get('/me/purchased-items', async () => {
      await gate;
      return PURCHASED_PAGE;
    });
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
    });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('purchased-rail-loading')).toBeVisible();
    const before = await visibleBlocks(page);
    // Thứ tự của khách cũ: Dành cho bạn đứng TRƯỚC Bán chạy (khách mới thì ngược lại).
    expect(before.indexOf('forYou')).toBeGreaterThanOrEqual(0);
    expect(before.indexOf('forYou')).toBeLessThan(before.indexOf('bestSellers'));
    expect(before.indexOf('bestSellers')).toBeLessThan(before.indexOf('categories'));

    release();
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    const after = await visibleBlocks(page);
    expect(after.filter((b) => b !== 'purchased')).toEqual(before.filter((b) => b !== 'purchased'));
  });

  test('Trang chủ có đúng một h1 (logo) và các khối chính là landmark có tên', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('Đã xem gần đây: mở 1 SP từ "Bán chạy" rồi quay lại → khối "Đã xem gần đây" có SP đó', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    await expect(page.getByRole('region', { name: 'Đã xem gần đây' })).toHaveCount(0);

    await best.getByRole('button', { name: XA_PHONG.name }).click();
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tubu_recently_viewed') ?? '[]').map((x: { slug: string }) => x.slug)), { timeout: 15_000 })
      .toEqual([XA_PHONG.slug]);
    await page.goBack();
    const recent = page.getByRole('region', { name: 'Đã xem gần đây' });
    await expect(recent.getByRole('button', { name: XA_PHONG.name })).toBeVisible({ timeout: 15_000 });
  });

  test('Analytics: chạm SP ở Trang chủ không bắn search_result_clicked (chỉ có khi đang tìm)', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await best.getByRole('button', { name: XA_PHONG.name }).click({ timeout: 15_000 });
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => api.callsTo('POST', '/events').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(eventsNamed(api, 'search_result_clicked')).toEqual([]);
  });
});
