import { test, expect, type MockApi } from './support/mock-api';
import type { Page } from '@playwright/test';
import { DELIVERED_CODE, PURCHASED_PAGE, THUMB, mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';

/**
 * Zalo Mini App E2E — Dự án 4a "Nhịp mua lại + tab bar + đặt hàng thành công"
 * (docs/superpowers/specs/2026-09-30-buy-flow-redesign-design.md §3-4). API mock toàn bộ.
 */
/**
 * Chờ kệ Mua lại ở trạng thái CUỐI (đã gọi /me/purchased-items và skeleton đã biến mất) — nếu không,
 * "kệ vắng mặt" có thể đúng chỉ vì query còn bị tắt (chờ đăng nhập) chứ chưa nhận phản hồi.
 */
async function waitRailSettled(page: Page, api: MockApi): Promise<void> {
  await expect.poll(() => api.callsTo('GET', '/me/purchased-items').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
}

test.describe('Buy-flow 4a — mua lại, tab Đơn hàng', () => {
  test('Home: kệ "Mua lại" là khối đầu tiên dưới ô tìm; mua lại 1 SP đúng 2 chạm, ở lại trang chủ', async ({ page, api }) => {
    mockBuyFlowSession(api);
    await page.goto('/');

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    const [searchBox, railBox, aiBox] = await Promise.all([
      page.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }).boundingBox(),
      rail.boundingBox(),
      page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox(),
    ]);
    expect(railBox!.y).toBeGreaterThan(searchBox!.y);
    expect(railBox!.y).toBeLessThan(aiBox!.y);

    const added = api.waitForCall('POST', '/cart/items');
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click(); // chạm 1
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click(); // chạm 2
    const call = await added;
    expect(call.body).toEqual({ variationId: 'var-1', quantity: 1, addSource: 'repurchase' });
    await expect(page.getByText('Đã thêm 1 món vào giỏ')).toBeVisible();
    await expect(page.getByText('Xem giỏ')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Skeleton kệ Mua lại cao xấp xỉ kệ thật (≤ 16px) → dữ liệu về không đẩy nội dung bên dưới', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    mockBuyFlowSession(api);
    // Giữ phản hồi purchased-items để skeleton đứng yên cho tới khi ta cho nó về.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.get('/me/purchased-items', async () => {
      await gate;
      return PURCHASED_PAGE;
    });
    await page.goto('/');

    const skeleton = page.getByTestId('purchased-rail-loading');
    await expect(skeleton).toBeVisible({ timeout: 15_000 });
    const skeletonBox = await skeleton.boundingBox();
    const aiBefore = await page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox();
    release();

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    const railBox = await rail.boundingBox();
    const aiAfter = await page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox();

    expect(Math.abs(skeletonBox!.height - railBox!.height), `skeleton ${skeletonBox!.height}px vs kệ ${railBox!.height}px`).toBeLessThanOrEqual(16);
    // Hệ quả người dùng thấy: khối bên dưới (nút "Hỏi trợ lý AI") gần như không nhảy vị trí.
    expect(Math.abs(aiAfter!.y - aiBefore!.y), 'khối bên dưới bị đẩy').toBeLessThanOrEqual(16);
  });

  test('Khách mới (chưa có đơn giao) → không có kệ Mua lại', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: { items: [], nextCursor: null } });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Xà Phòng Thảo Mộc Tubu' }).first()).toBeVisible({ timeout: 15_000 });
    await waitRailSettled(page, api);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
  });

  test('API cũ (purchased-items 404) → kệ ẩn im lặng, không có "Thử lại"', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: 'not-found' });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Xà Phòng Thảo Mộc Tubu' }).first()).toBeVisible({ timeout: 15_000 });
    await waitRailSettled(page, api);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  });

  test('Tab bar: "Đơn hàng" thay "Ví & HH", badge đơn đang xử lý; /orders là trang gốc', async ({ page, api }) => {
    mockBuyFlowSession(api, { activeCount: 2 });
    mockOrdersTab(api);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    for (const label of ['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Cá nhân']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Ví & HH')).toHaveCount(0);
    const ordersTab = nav.getByRole('button', { name: 'Đơn hàng, 2 đơn đang xử lý' });
    await expect(ordersTab).toBeVisible();
    await expect(ordersTab.getByText('2', { exact: true })).toBeVisible();

    await ordersTab.click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Đơn hàng' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quay lại' })).toHaveCount(0);
    await expect(nav).toBeVisible();
  });

  test('Trang Đơn hàng: kệ Mua lại + 7 tab (có Định kỳ); "Đang xử lý" gửi group=processing; "Định kỳ" hiện lịch', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders');

    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` })).toBeVisible();
    const tabs = page.getByRole('tablist');
    for (const t of ['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ']) {
      await expect(tabs.getByRole('tab', { name: t, exact: true })).toBeVisible();
    }

    const filtered = api.waitForCall('GET', '/orders');
    await tabs.getByRole('tab', { name: 'Đang xử lý' }).click();
    const call = await filtered;
    expect(call.query.get('group')).toBe('processing');
    expect(call.query.get('status')).toBeNull();
    // Mock lọc theo group: đơn đã giao không thuộc "Đang xử lý" → danh sách phải làm mới thành rỗng.
    await expect(page.getByText('Không có đơn nào ở mục này')).toBeVisible();
    await expect(page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` })).toHaveCount(0);

    const delivered = api.waitForCall('GET', '/orders');
    await tabs.getByRole('tab', { name: 'Đã giao' }).click();
    expect((await delivered).query.get('status')).toBe('DELIVERED');
    await expect(page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Định kỳ' }).click();
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible();
  });

  test('/subscriptions (link cũ) → /orders?tab=subscriptions, tab Định kỳ đang chọn', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/subscriptions');
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Thẻ đơn: ảnh SP đầu, "3 món"; "Mua lại" → sheet khoá dòng hết hàng, chỉ gửi dòng còn hàng → /cart', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders');

    const card = page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('img')).toHaveAttribute('src', THUMB);
    await expect(card.getByText(/3 món/)).toBeVisible();

    await card.getByRole('button', { name: 'Mua lại', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Chọn Xà Phòng Tubu Đã Hết' })).toBeDisabled();
    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await page.getByRole('button', { name: 'Thêm vào giỏ (2)' }).click();
    const call = await posted;
    expect(call.body).toEqual({ items: [{ orderItemId: 'oi-avail', quantity: 2 }], addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
  });

  test('/subscriptions là redirect thay thế (replace): không vòng lặp, nút Back về trang trước, không về /subscriptions', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });

    // Mô phỏng điều hướng trong app tới link cũ /subscriptions (react-router lắng nghe popstate).
    const historyBefore = await page.evaluate(() => history.length);
    await page.evaluate(() => {
      history.pushState({}, '', '/subscriptions');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible();

    // Redirect là replace: lịch sử chỉ thêm ĐÚNG 1 mục (pushState của chính test), không thêm mục cho /orders.
    expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    // Trang Đơn hàng có thể còn mount trong lúc chuyển cảnh — chờ nó biến mất rồi mới kiểm trang chủ.
    await expect(page.getByRole('heading', { name: 'Đơn hàng' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' })).toBeVisible();
  });

  test('Analytics: reorder_clicked bắn đúng 1 lần MỖI chạm {source:home_rail, variationId}, không bắn lại khi re-render', async ({ page, api }) => {
    mockBuyFlowSession(api);
    api.post('/events', { accepted: 1 });
    await page.goto('/');

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    const addBtn = page.getByRole('button', { name: 'Thêm vào giỏ (1)' });

    // Chạm 1: mở sheet rồi thêm vào giỏ (sheet đóng; state sheet + giỏ cập nhật → nhiều lần re-render).
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click();
    await expect(addBtn).toBeVisible();
    const added = api.waitForCall('POST', '/cart/items');
    await addBtn.click();
    await added;
    await expect(page.getByText('Đã thêm 1 món vào giỏ')).toBeVisible();
    await expect(addBtn).toBeHidden();

    // Chạm 2: mở lại sheet (target mới) rồi để nguyên — sheet mở lại phải tính thêm ĐÚNG 1 lần.
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click();
    await expect(addBtn).toBeVisible();

    // Hàng đợi sự kiện chỉ xả khi app bị ẩn (hoặc mỗi 10s) — ép xả rồi gom mọi lô /events đã tới.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const reorderClicks = () =>
      api
        .callsTo('POST', '/events')
        .flatMap((c) => (c.body as { events: { eventName: string; props: Record<string, unknown> }[] }).events)
        .filter((e) => e.eventName === 'reorder_clicked');
    await expect.poll(() => reorderClicks().length).toBeGreaterThanOrEqual(2);
    const clicks = reorderClicks();
    expect(clicks).toHaveLength(2);
    for (const c of clicks) expect(c.props).toEqual({ source: 'home_rail', variationId: 'var-1' });
  });
});
