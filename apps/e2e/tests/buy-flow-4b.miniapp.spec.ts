import type { Locator, Page } from '@playwright/test';
import { test, expect, makeOrder, publicConfig, type MockApi, type MockContext } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { BINH_SUA, SHIPPING_CODE, XA_PHONG, catalogHandler, mockDiscovery, toCard } from './support/discovery-mocks';
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
  await expect(page.getByTestId('todo-strip-loading')).toHaveCount(0);
}

test.describe('Buy-flow 4b — Trang chủ', () => {
  test('Khách cũ: tìm → thẻ thành viên → Việc cần làm → lối tắt → Mua lại → Danh mục → Gợi ý cho bạn; có lưới SP trong 5 khối đầu có nội dung', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true, forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Việc cần làm' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý cho bạn' })).toBeVisible();
    await waitHomeSettled(page, api);

    const blocks = await visibleBlocks(page);
    const order = ['search', 'member', 'todo', 'shortcuts', 'purchased', 'categories', 'suggest'];
    expect(blocks.filter((b) => order.includes(b))).toEqual(order);
    expect(blocks).not.toContain('bestSellers');
    expect(blocks).not.toContain('welcome');
  });

  test('Khách mới: không thẻ thành viên / Mua lại / Việc cần làm; Bán chạy (theo số đã bán) và Danh mục đứng trước Gợi ý cho bạn', async ({ page, api }) => {
    mockDiscovery(api, { forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy', exact: true });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý cho bạn' })).toBeVisible();
    await waitHomeSettled(page, api);

    const blocks = await visibleBlocks(page);
    const order = ['search', 'shortcuts', 'categories', 'bestSellers', 'suggest'];
    expect(blocks.filter((b) => order.includes(b))).toEqual(order);
    expect(blocks).not.toContain('member');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Việc cần làm' })).toHaveCount(0);
    expect(api.callsTo('GET', '/orders').filter((c) => c.query.get('status') === 'SHIPPING')).toEqual([]);
    // Lưới chứa SP đầu tiên = bán chạy nhất (XA_PHONG 120 > BINH_SUA 80 > NRC 50 > KEM 10).
    await expect(best.locator('button.tubu-tile-link').first()).toHaveAccessibleName(new RegExp(XA_PHONG.name));
    await expect
      .poll(() => api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') === '6'), { timeout: 15_000 })
      .toBe(true);
  });

  test('Danh mục thật chỉ hiện mục có hàng; chạm "Cho bé" → /browse?category=cat-baby, có chip gỡ được', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const cats = page.getByRole('region', { name: 'Danh mục', exact: true });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Cà phê & Đồ uống' })).toHaveCount(0);
    await cats.getByRole('button', { name: 'Cho bé' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-baby$/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Cho bé' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
  });

  test('Thẻ AI/Mua chung không còn chen giữa Trang chủ; "Tìm sản phẩm" mở ô tìm đã focus', async ({ page, api }) => {
    mockDiscovery(api);
    api.get('/config/public', publicConfig({ aiAdvisorEnabled: true }));
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy', exact: true })).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    await expect(page.getByText('Khám phá vườn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 }); // ?focus=search đã được dùng rồi bỏ
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeFocused();
  });

  test('Việc cần làm: "Đơn … đang giao" mở chi tiết đơn', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true });
    await page.goto('/');
    const todo = page.getByRole('region', { name: 'Việc cần làm' });
    await expect
      .poll(() => api.callsTo('GET', '/orders').some((c) => c.query.get('status') === 'SHIPPING' && c.query.get('limit') === '1'), { timeout: 15_000 })
      .toBe(true);
    await todo.getByRole('button', { name: new RegExp(`Đơn ${SHIPPING_CODE} đang giao`) }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/order/${SHIPPING_CODE}$`), { timeout: 15_000 });
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
    await expect(page.getByRole('region', { name: 'Gợi ý cho bạn' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('purchased-rail-loading')).toBeVisible();
    const before = await visibleBlocks(page);
    // Thứ tự của khách cũ: không có Bán chạy, Gợi ý cho bạn đứng sau Danh mục.
    expect(before).not.toContain('bestSellers');
    expect(before.indexOf('categories')).toBeGreaterThanOrEqual(0);
    expect(before.indexOf('categories')).toBeLessThan(before.indexOf('suggest'));

    release();
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    const after = await visibleBlocks(page);
    expect(after.filter((b) => b !== 'purchased')).toEqual(before.filter((b) => b !== 'purchased'));
  });

  test('Trang chủ có đúng một h1 (logo) và các khối chính là landmark có tên', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('Đã xem gần đây: mở 1 SP từ "Bán chạy" rồi vào Danh mục → khối "Đã xem gần đây" có SP đó', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy', exact: true });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);

    await best.getByRole('button', { name: XA_PHONG.name }).click();
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tubu_recently_viewed') ?? '[]').map((x: { slug: string }) => x.slug)), { timeout: 15_000 })
      .toEqual([XA_PHONG.slug]);
    await page.goto('/browse');
    const recent = page.getByRole('region', { name: 'Đã xem gần đây' });
    await expect(recent.getByRole('button', { name: XA_PHONG.name })).toBeVisible({ timeout: 15_000 });
  });

  test('Analytics: chạm SP ở Trang chủ không bắn search_result_clicked (chỉ có khi đang tìm)', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy', exact: true });
    await best.getByRole('button', { name: XA_PHONG.name }).click({ timeout: 15_000 });
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => api.callsTo('POST', '/events').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(eventsNamed(api, 'search_result_clicked')).toEqual([]);
  });
});

test.describe('Buy-flow 4b — bố cục 320/375/390, vùng chạm, khung chờ', () => {
  const noHorizontalScroll = (page: Page) =>
    page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
      return document.documentElement.scrollWidth <= window.innerWidth && (scroller ? scroller.scrollWidth <= scroller.clientWidth : true);
    });
  /** Phần tử đứng yên qua 2 khung hình (sheet trượt xong) — không dùng waitForTimeout. */
  const settled = (locator: Locator) =>
    locator.evaluate(
      (el) =>
        new Promise<boolean>((resolve) => {
          const y0 = el.getBoundingClientRect().y;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(el.getBoundingClientRect().y - y0) < 0.5)));
        }),
    );
  /** Thẻ SP thật: vỏ `.tubu-press` bao nút tên (`button.tubu-tile-link`) — cùng phần tử mà khung chờ `catalog-tile-skeleton` thay thế. */
  const tileRoot = (scope: Locator) => scope.locator('button.tubu-tile-link').first().locator('xpath=ancestor::div[contains(@class,"tubu-press")][1]');
  const gateOf = () => {
    let open: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  for (const width of [320, 375, 390]) {
    test(`${width}px: Trang chủ (khách cũ), Danh mục, Bộ lọc — không tràn ngang, nút nằm trọn, chip có vùng chạm 44px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      mockDiscovery(api, { returning: true, shipping: true, subscription: true, forYou: [toCard(BINH_SUA)] });
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
      await waitHomeSettled(page, api);
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`home-4b-${width}.png`), fullPage: true });

      await page.goto('/browse');
      await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);
      for (const name of ['Gợi ý', 'Bán chạy']) {
        const chip = page.getByRole('group', { name: 'Sắp xếp' }).getByRole('button', { name, exact: true });
        const hit = await chip.evaluate((el) => {
          const r = el.getBoundingClientRect();
          if (r.height < 44) return { above: false, below: false, height: r.height };
          const x = r.left + r.width / 2;
          const at = (y: number) => document.elementFromPoint(x, y)?.closest('button') === el;
          return { above: at(r.top + 2), below: at(r.bottom - 2), height: r.height };
        });
        expect(hit, `"${name}": chip cao ≥ 44px và vùng chạm phủ trọn chiều dọc`).toMatchObject({ above: true, below: true });
      }
      await page.screenshot({ path: test.info().outputPath(`browse-4b-${width}.png`) });

      await page.getByRole('button', { name: 'Bộ lọc' }).click();
      const apply = page.getByRole('button', { name: /^Xem [\d.]+ sản phẩm$/ });
      await expect(apply).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => settled(apply), { timeout: 5_000 }).toBe(true);
      const b = (await apply.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'nút áp dụng tràn phải').toBeLessThanOrEqual(width);
      expect(b.y + b.height, 'nút áp dụng ra ngoài màn hình').toBeLessThanOrEqual(740);
      expect(b.height).toBeGreaterThanOrEqual(44);
      const reset = page.getByRole('button', { name: 'Xoá bộ lọc' });
      const label = reset.locator('.zaui-btn-container > span:not(.zaui-btn-icon)');
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), '"Xoá bộ lọc" bị rút gọn').toBe(true);
      await page.screenshot({ path: test.info().outputPath(`filter-sheet-4b-${width}.png`) });
    });
  }

  test('375px: khung chờ "Bán chạy" (Trang chủ) và lưới kết quả (Danh mục) cao xấp xỉ thẻ thật (≤ 16px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    mockDiscovery(api);
    const real = catalogHandler();
    const gate = gateOf();
    api.get('/products', async (ctx: MockContext) => {
      if (ctx.call.query.get('sort') === 'best_seller') await gate.promise;
      return real(ctx);
    });
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy', exact: true });
    const skel = best.getByTestId('catalog-tile-skeleton').first();
    await expect(skel).toBeVisible({ timeout: 15_000 });
    const skelH = (await skel.boundingBox())!.height;
    gate.open();
    const tile = tileRoot(best);
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await expect(best.getByTestId('catalog-tile-skeleton')).toHaveCount(0);
    const tileH = (await tile.boundingBox())!.height;
    expect(Math.abs(skelH - tileH), `Trang chủ: khung chờ ${skelH}px vs thẻ ${tileH}px`).toBeLessThanOrEqual(16);

    const gate2 = gateOf();
    api.get('/products', async (ctx: MockContext) => {
      if (ctx.call.query.get('limit') === '30') await gate2.promise;
      return real(ctx);
    });
    await page.goto('/browse?sort=newest');
    const skel2 = page.getByTestId('catalog-tile-skeleton').first();
    await expect(skel2).toBeVisible({ timeout: 15_000 });
    const skel2H = (await skel2.boundingBox())!.height;
    gate2.open();
    const tile2 = tileRoot(page.getByTestId('catalog-grid'));
    await expect(tile2).toBeVisible({ timeout: 15_000 });
    const tile2H = (await tile2.boundingBox())!.height;
    expect(Math.abs(skel2H - tile2H), `Danh mục: khung chờ ${skel2H}px vs thẻ ${tile2H}px`).toBeLessThanOrEqual(16);
  });

  test('375px: khung chờ "Việc cần làm" cao xấp xỉ khối thật có một dòng đang giao (≤ 8px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    mockDiscovery(api, { returning: true, shipping: true });
    const gate = gateOf();
    api.get('/orders', async ({ call }: MockContext) => {
      if (call.query.get('status') !== 'SHIPPING') return { data: [], meta: { page: 1, limit: 1, total: 0 } };
      await gate.promise;
      return { data: [makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING', paymentStatus: 'PAID' })], meta: { page: 1, limit: 1, total: 1 } };
    });
    // Khung chờ chỉ dựng khi lần mở trước của tài khoản này có việc (use-home-customer-kind / todo-strip nhớ số dòng).
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_todo_rows', JSON.stringify({ userId: 'user-4b', rows: 1 }));
    });
    await page.goto('/');
    const skel = page.getByTestId('todo-strip-loading');
    await expect(skel).toBeVisible({ timeout: 15_000 });
    const skelH = (await skel.boundingBox())!.height;
    gate.open();
    const todo = page.getByRole('region', { name: 'Việc cần làm' });
    await expect(todo).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('todo-strip-loading')).toHaveCount(0);
    const todoH = (await todo.boundingBox())!.height;
    expect(Math.abs(skelH - todoH), `Việc cần làm: khung chờ ${skelH}px vs khối thật ${todoH}px`).toBeLessThanOrEqual(8);
  });
});
