import { test, expect, makeOrder, reply, type MockApi, type MockHandler } from './support/mock-api';
import type { Page } from '@playwright/test';
import { DELIVERED_CODE, HOME_PRODUCT, PURCHASED, PURCHASED_PAGE, REMINDER, THUMB, mockBuyFlowSession, mockHomeBestSellers, mockOrdersTab } from './support/buy-flow-mocks';
import { mockCheckout, placedOrderFor, publicConfig, ORDER_CODE_COD } from './support/checkout-mocks';
import { mockWorld as mockCheckoutWorld, openState as openCheckoutState } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { expectNoHorizontalOverflow } from './support/game-mini-mocks';
import { ORDER_ZALO_STATUS } from './support/order-zalo-mocks';
import { PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';
import { eventsNamed, flushEvents } from './support/events';

/**
 * Zalo Mini App E2E — Dự án 4a "Nhịp mua lại + tab bar + đặt hàng thành công"
 * (docs/superpowers/specs/2026-09-30-buy-flow-redesign-design.md §3-4). API mock toàn bộ.
 */
/** Thẻ đơn (vỏ không tương tác) chứa nút mở đơn "Đơn <mã>"; "Mua lại" là anh em của nút đó nên phải tìm trong vỏ. */
const orderCardOf = (page: Page, code: string) =>
  page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: `Đơn ${code}` }) });

/**
 * Chờ kệ Mua lại ở trạng thái CUỐI (đã gọi /me/purchased-items và skeleton đã biến mất) — nếu không,
 * "kệ vắng mặt" có thể đúng chỉ vì query còn bị tắt (chờ đăng nhập) chứ chưa nhận phản hồi.
 */
async function waitRailSettled(page: Page, api: MockApi): Promise<void> {
  await expect.poll(() => api.callsTo('GET', '/me/purchased-items').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
}

/**
 * Lưới "Gợi ý hôm nay" nằm cuối Trang chủ và chỉ tải khi khối cách màn hình chưa tới một màn (suggest-feed.tsx); sau khi màn đầu gọn lại
 * (lối tắt, danh mục một hàng, hành trình, chẩn đoán) nó nằm xa hơn, nên khách phải cuộn tới thì mới có sản phẩm.
 */
async function showSuggestFeed(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Gợi ý hôm nay' }).scrollIntoViewIfNeeded();
}

test.describe('Buy-flow 4a — mua lại, tab Đơn hàng', () => {
  test('Home: kệ "Mua lại" nằm dưới Bán chạy nhất và trên lối tắt; mua lại 1 SP đúng 2 chạm rồi tự sang giỏ', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockHomeBestSellers(api);
    await page.goto('/');

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    const [searchBox, categoriesBox, bestBox, railBox, shortcutsBox] = await Promise.all([
      page.getByRole('button', { name: 'Bạn tìm gì hôm nay?' }).boundingBox(),
      page.getByRole('region', { name: 'Danh mục', exact: true }).boundingBox(),
      page.getByRole('region', { name: 'Bán chạy nhất', exact: true }).boundingBox(),
      rail.boundingBox(),
      page.locator('[data-home-block="shortcuts"]').boundingBox(),
    ]);
    expect(categoriesBox!.y).toBeGreaterThan(searchBox!.y);
    expect(railBox!.y).toBeGreaterThan(bestBox!.y);
    expect(railBox!.y).toBeLessThan(shortcutsBox!.y);

    const added = api.waitForCall('POST', '/cart/items');
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click(); // chạm 1
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click(); // chạm 2
    const call = await added;
    expect(call.body).toEqual({ variationId: 'var-1', quantity: 1, addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
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
    // Khối Mua lại chỉ có chỗ khi khách đã được nhớ là khách cũ (use-home-customer-kind.ts).
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4a', kind: 'returning' }));
    });
    await page.goto('/');

    const skeleton = page.getByTestId('purchased-rail-loading');
    await expect(skeleton).toBeVisible({ timeout: 15_000 });
    const skeletonBox = await skeleton.boundingBox();
    const belowBefore = await page.locator('[data-home-block="shortcuts"]').boundingBox();
    release();

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    const railBox = await rail.boundingBox();
    const belowAfter = await page.locator('[data-home-block="shortcuts"]').boundingBox();

    expect(Math.abs(skeletonBox!.height - railBox!.height), `skeleton ${skeletonBox!.height}px vs kệ ${railBox!.height}px`).toBeLessThanOrEqual(16);
    // Hệ quả người dùng thấy: khối bên dưới (lối tắt) gần như không nhảy vị trí.
    expect(Math.abs(belowAfter!.y - belowBefore!.y), 'khối bên dưới bị đẩy').toBeLessThanOrEqual(16);
  });

  test('Home: khách cũ đã nhớ loại — lối tắt (khối dưới Mua lại) không xê dịch khi purchased-items về (thứ tự khối đúng ngay từ đầu)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    mockBuyFlowSession(api);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.get('/me/purchased-items', async () => {
      await gate;
      return PURCHASED_PAGE;
    });
    // Lần mở trước đã ghi nhớ đây là khách cũ (key/dạng khớp use-home-customer-kind.ts; userId của mockBuyFlowSession).
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4a', kind: 'returning' }));
    });
    await page.goto('/');

    const member = page.getByRole('region', { name: 'Thẻ thành viên' });
    const below = page.locator('[data-home-block="shortcuts"]');
    await expect(member).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('purchased-rail-loading')).toBeVisible(); // purchased-items vẫn đang chờ
    const before = await below.boundingBox();

    release();
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
    const after = await below.boundingBox();
    expect(Math.abs(after!.y - before!.y), `Lối tắt bị đẩy ${Math.abs(after!.y - before!.y)}px khi purchased-items về`).toBeLessThanOrEqual(2);
  });

  test('Khách mới (chưa có đơn giao) → không có kệ Mua lại', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: { items: [], nextCursor: null } });
    await page.goto('/');
    await showSuggestFeed(page);
    await expect(page.getByRole('button', { name: 'Xà Phòng Thảo Mộc Tubu' }).first()).toBeVisible({ timeout: 15_000 });
    await waitRailSettled(page, api);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
  });

  test('API cũ (purchased-items 404) → kệ ẩn im lặng, không có "Thử lại"', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: 'not-found' });
    await page.goto('/');
    await showSuggestFeed(page);
    await expect(page.getByRole('button', { name: 'Xà Phòng Thảo Mộc Tubu' }).first()).toBeVisible({ timeout: 15_000 });
    await waitRailSettled(page, api);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  });

  test('Tab bar: "Ưu đãi" thay "Đơn hàng", badge đơn đang xử lý nằm ở Cá nhân; /orders vẫn mở được', async ({ page, api }) => {
    mockBuyFlowSession(api, { activeCount: 2 });
    mockOrdersTab(api);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    for (const label of ['Trang chủ', 'Danh mục', 'Vườn Xanh']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Ví & HH')).toHaveCount(0);
    await expect(nav.getByText('Đơn hàng', { exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /^Ưu đãi/ })).toBeVisible();
    const profileTab = nav.getByRole('button', { name: 'Cá nhân, 2 đơn đang xử lý' });
    await expect(profileTab).toBeVisible();
    await expect(profileTab.getByText('2', { exact: true })).toBeVisible();

    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Đơn hàng' })).toBeVisible({ timeout: 15_000 });
  });

  test('Trang Đơn hàng: kệ Mua lại + 7 tab (Định kỳ luôn hiện vì cờ bật, W143); "Đang xử lý" gửi group=processing', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    // Cờ SUBSCRIPTIONS_IN_MINIAPP bật: tab Định kỳ hiện cả khi khách chưa có gói.
    api.get('/me/subscriptions', []);
    await page.goto('/orders');

    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` })).toBeVisible();
    const tabs = page.getByRole('tablist');
    for (const t of ['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn', 'Định kỳ']) {
      await expect(tabs.getByRole('tab', { name: t, exact: true })).toBeVisible();
    }
    await expect(tabs.getByRole('tab')).toHaveCount(7);
    // Cờ bật: kệ Mua lại ở tab Đơn hàng mời "Định kỳ" cho món đủ điều kiện (retailOnly=false, còn hàng); ở Trang chủ thì không (home-h.miniapp.spec.ts).
    await expect(page.getByRole('region', { name: 'Mua lại' }).getByRole('button', { name: /^Định kỳ -\d+%$/ })).toBeVisible();

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
  });

  test('/subscriptions là trang đích Mua xoay vòng (W171), không còn redirect: khách chưa có gói thấy quyền lợi + kệ sản phẩm; nút "Xem mục Định kỳ" mở thẳng tab Định kỳ', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions', []);
    api.get('/products/best-sellers', { data: [HOME_PRODUCT], meta: { page: 1, limit: 12, total: 1 } });
    await page.goto('/subscriptions');
    await expect(page.getByTestId('subscription-hero')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('subscription-products')).toBeVisible();
    await expect(page).toHaveURL(/\/subscriptions$/);

    await page.getByRole('button', { name: 'Xem mục Định kỳ trong Đơn hàng' }).click();
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'false');
  });

  test('Thẻ đơn: ảnh SP đầu, "3 món"; "Mua lại" → sheet khoá dòng hết hàng, chỉ gửi dòng còn hàng → /cart', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders');

    const card = orderCardOf(page, DELIVERED_CODE);
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

  test('Thẻ đơn: chạm vùng trống cạnh "Mua lại" mở chi tiết đơn; chạm đúng nút mở sheet và KHÔNG chuyển trang', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/orders/:code', ({ params }) => makeOrder({ code: params.code!, status: 'DELIVERED', paymentStatus: 'PAID' }));
    api.get('/orders/me/returns', []);
    await page.goto('/orders');

    const card = orderCardOf(page, DELIVERED_CODE);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const button = card.getByRole('button', { name: 'Mua lại', exact: true });

    // Chạm nút → sheet mở, vẫn ở /orders.
    await button.click();
    await expect(page.getByRole('checkbox', { name: 'Chọn Xà Phòng Tubu Đã Hết' })).toBeDisabled();
    await expect(page).toHaveURL(/\/orders$/);
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Chọn Xà Phòng Tubu Đã Hết' })).toHaveCount(0);

    // Chạm cạnh nút (mép trái của hàng nút, cách nút xa) → mở chi tiết đơn.
    const row = card.getByTestId('order-card-actions');
    await row.scrollIntoViewIfNeeded();
    const rowBox = (await row.boundingBox())!;
    const btnBox = (await button.boundingBox())!;
    expect(btnBox.x - rowBox.x).toBeGreaterThan(40); // có vùng trống thật bên trái nút
    await page.mouse.click(rowBox.x + 12, rowBox.y + rowBox.height / 2);
    await expect(page).toHaveURL(new RegExp(`/order/${DELIVERED_CODE}$`), { timeout: 10_000 });
  });

  test('/subscriptions là trang đích thật (không redirect): không thêm mục lịch sử nào ngoài lần vào, nút Back về trang trước, không vòng lặp', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions', []);
    api.get('/products/best-sellers', { data: [HOME_PRODUCT], meta: { page: 1, limit: 12, total: 1 } });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });

    // Mô phỏng điều hướng trong app tới /subscriptions (react-router lắng nghe popstate).
    const historyBefore = await page.evaluate(() => history.length);
    await page.evaluate(() => {
      history.pushState({}, '', '/subscriptions');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByTestId('subscription-hero')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/subscriptions$/);
    // Giữ nguyên URL, không bị chuyển sang /orders; lịch sử chỉ thêm ĐÚNG 1 mục (pushState của chính test).
    expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('subscription-hero')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bạn tìm gì hôm nay?' })).toBeVisible();
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
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    await expect(addBtn).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(rail).toBeVisible({ timeout: 15_000 });

    // Chạm 2: mở lại sheet (target mới) rồi để nguyên — sheet mở lại phải tính thêm ĐÚNG 1 lần.
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click();
    await expect(addBtn).toBeVisible();

    await flushEvents(page);
    const reorderClicks = () => eventsNamed(api, 'reorder_clicked');
    await expect.poll(() => reorderClicks().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const clicks = reorderClicks();
    expect(clicks).toHaveLength(2);
    for (const c of clicks) expect(c.props).toEqual({ source: 'home_rail', variationId: 'var-1' });
  });
});

const PDP_SLUG_PATH = `/product/${PILOT_SLUG}`;
const NOT_FOUND = reply(404, { statusCode: 404, message: 'Cannot GET' });

/** Trang đích dự phòng của nhắc mua lại (PDP) — mock đủ để điều hướng không dính lỗi 404. */
function mockPdp(api: MockApi): void {
  api.get('/products/:slug', PILOT_PRODUCT);
  api.get('/products/:slug/related', []);
  api.get('/products/:slug/bought-together', []);
  api.get('/products/:slug/reviews', { average: 0, count: 0, items: [] });
  api.allowUnmocked('GET /products/:slug/reviews/can-review');
}

/** Mock cho /notifications với một thông báo nhắc mua lại; `purchased` là handler của tra cứu variation. */
function mockReminder(api: MockApi, purchased: MockHandler, data: Record<string, string> = REMINDER.payload.data as Record<string, string>): void {
  mockBuyFlowSession(api);
  api.get('/me/notifications', [{ ...REMINDER, payload: { ...REMINDER.payload, data } }]);
  api.get('/me/notifications/unread-count', { count: 1 });
  api.post('/me/notifications/:id/read', { ok: true });
  api.post('/events', { accepted: 1 });
  api.get('/me/purchased-items', purchased);
}

async function openReminderDetail(page: Page): Promise<void> {
  await page.getByText('Nhắc mua lại').first().click({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Mua lại ngay' })).toBeVisible();
}

test.describe('Buy-flow 4a — nhắc mua lại, đặt hàng thành công, bố cục', () => {
  test('Thông báo nhắc mua lại: "Mua lại ngay" mở sheet đúng variation; thêm giỏ với addSource=reorder_notification; CTA bắn 1 lần', async ({ page, api }) => {
    mockReminder(api, ({ call }) =>
      call.query.get('variationId') === 'var-1' ? PURCHASED_PAGE : { items: [], nextCursor: null },
    );
    await page.goto('/notifications');
    await openReminderDetail(page);

    const lookup = api.waitForCall('GET', '/me/purchased-items');
    await page.getByRole('button', { name: 'Mua lại ngay' }).click();
    const lookupCall = await lookup;
    expect(lookupCall.query.get('variationId')).toBe('var-1');
    expect(lookupCall.query.get('limit')).toBe('1');

    // Sheet mở đúng 1 dòng: đúng SP của variation trong payload, còn hàng nên được chọn sẵn.
    await expect(page.getByRole('checkbox', { name: `Chọn ${PURCHASED.productName}` })).toBeChecked();
    const added = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click();
    expect((await added).body).toEqual({ variationId: 'var-1', quantity: 1, addSource: 'reorder_notification' });
    await expect(page.getByText('Đã thêm 1 món vào giỏ')).toBeVisible();
    await expect(page).toHaveURL(/\/notifications$/);

    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'reorder_reminder_cta').length, { timeout: 15_000 }).toBe(1);
    const cta = eventsNamed(api, 'reorder_reminder_cta')[0]!;
    expect(cta.props).toEqual({ notificationId: 'ntf-reorder-1' });
    expect(cta.notificationId).toBe('ntf-reorder-1');
    expect(eventsNamed(api, 'reorder_clicked').map((e) => e.props)).toEqual([{ source: 'notification', variationId: 'var-1' }]);
  });

  test('Chạm đúp "Mua lại ngay" khi đang tra cứu: đúng 1 lần tra cứu, 1 sự kiện CTA, sheet mở 1 lần', async ({ page, api }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockReminder(api, async () => {
      await gate;
      return PURCHASED_PAGE;
    });
    await page.goto('/notifications');
    await openReminderDetail(page);

    await page.getByRole('button', { name: 'Mua lại ngay' }).dblclick();
    release();
    await expect(page.getByRole('button', { name: 'Thêm vào giỏ (1)' })).toBeVisible();

    expect(api.callsTo('GET', '/me/purchased-items')).toHaveLength(1);
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'reorder_reminder_cta').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(eventsNamed(api, 'reorder_reminder_cta')).toHaveLength(1);
    expect(eventsNamed(api, 'reorder_clicked')).toHaveLength(1);
  });

  test('Rời màn chi tiết thông báo khi đang tra cứu: không mở sheet/không điều hướng muộn; CTA không bị kẹt', async ({ page, api }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    mockReminder(api, async () => {
      if (first) {
        first = false;
        await gate;
      }
      return PURCHASED_PAGE;
    });
    await page.goto('/notifications');
    await openReminderDetail(page);

    const lookup = api.waitForCall('GET', '/me/purchased-items');
    await page.getByRole('button', { name: 'Mua lại ngay' }).click();
    // Tra cứu đang treo → khách bấm Back (đóng chi tiết), rồi phản hồi mới về.
    await page.goBack(); // cử chỉ/nút Back của Zalo → popstate đóng lớp chi tiết
    await expect(page.getByRole('button', { name: 'Mua lại ngay' })).toHaveCount(0);
    release();
    await lookup;
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Thêm vào giỏ (1)' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/notifications$/);

    // Cờ bận đã được trả: mở lại thông báo → CTA hoạt động ngay (tra cứu lần 2 mở sheet).
    await openReminderDetail(page);
    await page.getByRole('button', { name: 'Mua lại ngay' }).click();
    await expect(page.getByRole('button', { name: 'Thêm vào giỏ (1)' })).toBeVisible({ timeout: 10_000 });
  });

  const EMPTY_PAGE = { items: [], nextCursor: null };
  const noSheetCases = [
    { name: 'tra cứu 404 (API cũ) + có slug → trang sản phẩm', purchased: NOT_FOUND, slug: true, to: PDP_SLUG_PATH },
    { name: 'SP không còn trong danh sách đã mua + có slug → trang sản phẩm', purchased: EMPTY_PAGE, slug: true, to: PDP_SLUG_PATH },
    { name: 'tra cứu 404 (API cũ) + thiếu slug → tab Đơn hàng', purchased: NOT_FOUND, slug: false, to: '/orders' },
    { name: 'SP không còn trong danh sách đã mua + thiếu slug → tab Đơn hàng', purchased: EMPTY_PAGE, slug: false, to: '/orders' },
    { name: 'API bỏ qua bộ lọc variationId và trả SP KHÁC + có slug → trang sản phẩm (không mở sheet sai SP)', purchased: { items: [{ ...PURCHASED, variationId: 'var-other', productName: 'Sản phẩm khác hẳn' }], nextCursor: null }, slug: true, to: PDP_SLUG_PATH },
    { name: 'SP còn trong danh sách nhưng hết hàng + có slug → trang sản phẩm', purchased: { items: [{ ...PURCHASED, inStock: false, stock: 0 }], nextCursor: null }, slug: true, to: PDP_SLUG_PATH },
  ];
  for (const c of noSheetCases) {
    test(`Nhắc mua lại: ${c.name}; không mở sheet, CTA bắn 1 lần`, async ({ page, api }) => {
      const data: Record<string, string> = { product: PURCHASED.productName, variation_id: 'var-1' };
      if (c.slug) data.product_slug = PURCHASED.slug;
      mockReminder(api, c.purchased, data);
      mockOrdersTab(api);
      mockPdp(api);
      await page.goto('/notifications');
      await openReminderDetail(page);

      await page.getByRole('button', { name: 'Mua lại ngay' }).click();
      await expect(page).toHaveURL(new RegExp(`${c.to.replace(/\//g, '\\/')}$`), { timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Thêm vào giỏ (1)' })).toHaveCount(0);
      expect(api.callsTo('GET', '/me/purchased-items').map((x) => x.query.get('variationId'))).toEqual(['var-1']);

      await flushEvents(page);
      await expect.poll(() => eventsNamed(api, 'reorder_reminder_cta').length, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(eventsNamed(api, 'reorder_reminder_cta')).toHaveLength(1);
    });
  }

  test('Đặt hàng thành công (DS v2): mã đơn sao chép được, tổng, điểm, giao dự kiến, 3 bước; có gợi ý Đặt định kỳ dưới hai CTA (cờ bật, W143); không lá rơi', async ({ page, api }) => {
    mockCheckout(api);
    api.get('/config/public', publicConfig({ shippingEta: { minDays: 2, maxDays: 4 } }));
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await placeBtn.click();

    await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ORDER_CODE_COD)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sao chép mã đơn' })).toBeVisible();
    await expect(page.getByText('149.000đ').first()).toBeVisible();
    await expect(page.getByText('+14 điểm, về khi đơn giao xong')).toBeVisible();
    await expect(page.getByText('Giao dự kiến')).toBeVisible();
    // 3 bước một hàng (như web khổ điện thoại): tên bước hiện, câu giải thích chỉ cho trình đọc màn hình.
    const steps = page.getByRole('region', { name: 'Tiếp theo' });
    await expect(steps.getByRole('listitem')).toHaveCount(3);
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) {
      await expect(steps.getByRole('listitem').filter({ hasText: s })).toBeVisible();
    }
    const rowTops = await steps.getByRole('listitem').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(rowTops).size, `3 bước phải cùng một hàng: ${rowTops.join(', ')}`).toBe(1);
    // Cờ SUBSCRIPTIONS_IN_MINIAPP bật: sản phẩm của đơn (PILOT_PRODUCT, còn hàng, không phải hàng gian hàng) đủ điều kiện nên có gợi ý;
    // nó nằm DƯỚI hai CTA để lúc sản phẩm tải xong không đẩy "Theo dõi đơn" đi chỗ khác.
    const subscribe = page.getByRole('button', { name: 'Đặt định kỳ' });
    await expect(subscribe).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Theo dõi đơn' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếp tục mua sắm' })).toBeVisible();
    const trackBox = (await page.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
    const continueBox = (await page.getByRole('button', { name: 'Tiếp tục mua sắm' }).boundingBox())!;
    await expect(subscribe).toBeVisible();
    const subscribeBox = (await subscribe.boundingBox())!;
    expect(subscribeBox.y, 'gợi ý định kỳ nằm dưới nút Theo dõi đơn').toBeGreaterThan(trackBox.y + trackBox.height - 1);
    expect(subscribeBox.y, 'gợi ý định kỳ nằm dưới nút Tiếp tục mua sắm').toBeGreaterThan(continueBox.y + continueBox.height - 1);
    await expect(page.locator('.tubu-leaf')).toHaveCount(0);
  });

  for (const width of [320, 375, 390]) {
    test(`Bố cục ${width}px: Home (kệ Mua lại), Đơn hàng + sheet Mua lại, màn thành công — không tràn ngang`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

      mockBuyFlowSession(api);
      mockOrdersTab(api);
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll()).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`home-${width}.png`) });

      await page.goto('/orders');
      const card = orderCardOf(page, DELIVERED_CODE);
      await expect(card).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll()).toBe(true);
      await card.getByRole('button', { name: 'Mua lại', exact: true }).click();
      const cta = page.getByRole('button', { name: 'Thêm vào giỏ (2)' });
      await expect(cta).toBeVisible();
      // Sheet trượt vào ~200ms: đợi nó dừng hẳn (CTA nằm trọn trong viewport và đứng yên) rồi mới đo/chụp.
      await expect
        .poll(async () => {
          const b1 = await cta.boundingBox();
          await page.waitForTimeout(150);
          const b2 = await cta.boundingBox();
          return !!b1 && !!b2 && b1.y === b2.y && b2.y + b2.height <= 740;
        }, { timeout: 5_000, message: 'CTA của sheet phải dừng và nằm trọn trong viewport' })
        .toBe(true);
      const ctaBox = await cta.boundingBox();
      expect(ctaBox!.x).toBeGreaterThanOrEqual(0);
      expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(width);
      const plusButtons = await page.getByRole('button', { name: 'Tăng số lượng' }).all();
      expect(plusButtons.length, 'không có nút Tăng số lượng nào để đo').toBeGreaterThan(0);
      for (const plus of plusButtons) {
        const b = await plus.boundingBox();
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
        expect(b!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: test.info().outputPath(`orders-sheet-${width}.png`) });
    });

    test(`Màn đặt hàng thành công ${width}px: nút nằm trọn trong màn hình`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      mockCheckout(api);
      api.get('/config/public', publicConfig({ shippingEta: { minDays: 2, maxDays: 4 } }));
      await page.goto('/checkout');
      const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
      await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
      await placeBtn.click();
      await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 10_000 });
      for (const name of ['Theo dõi đơn', 'Tiếp tục mua sắm', 'Sao chép mã đơn']) {
        const b = await page.getByRole('button', { name }).boundingBox();
        expect(b, name).not.toBeNull();
        expect(b!.x, `${name} tràn trái`).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`order-success-${width}.png`), fullPage: true });
    });
  }

  test('Chi tiết đơn 320px (followups DS v2): "Thanh toán ngay" + "Thêm thao tác" nằm trọn và không bị cắt chữ, "Huỷ đơn" ở menu', async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    mockBuyFlowSession(api);
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PAY-320', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' }));
    await page.goto('/order/TUBU-PAY-320');

    const bar = page.getByTestId('sticky-bar');
    const pay = bar.getByRole('button', { name: 'Thanh toán ngay' });
    const more = bar.getByRole('button', { name: 'Thêm thao tác' });
    await expect(pay).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByRole('button', { name: 'Huỷ đơn' })).toHaveCount(0);
    for (const [name, btn] of [['Thanh toán ngay', pay], ['Thêm thao tác', more]] as const) {
      const b = await btn.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(320);
      expect(b!.height, `${name} thấp hơn vùng chạm 44px`).toBeGreaterThanOrEqual(44);
      expect(b!.width, `${name} hẹp hơn vùng chạm 44px`).toBeGreaterThanOrEqual(44);
    }
    const label = pay.getByText('Thanh toán ngay', { exact: true });
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), '"Thanh toán ngay" bị rút gọn').toBe(true);

    await more.click();
    const cancel = page.getByRole('group', { name: 'Thao tác với đơn' }).getByRole('button', { name: 'Huỷ đơn' });
    await expect(cancel).toBeVisible();
    const c = await cancel.boundingBox();
    expect(c!.x + c!.width, 'Huỷ đơn tràn phải').toBeLessThanOrEqual(320);
    expect(c!.height, 'Huỷ đơn thấp hơn vùng chạm 44px').toBeGreaterThanOrEqual(44);
  });
});

test.describe('DS Button trên trình duyệt thật — nhãn hai dấu và vùng chạm', () => {
  /**
   * Không có trang nào cho phép đặt nhãn "Ẩn"/"Ấn" tuỳ ý, nên gắn trực tiếp DS Button thật vào trang
   * đang chạy trên Vite dev (import module từ chính URL đã nạp → cùng một bản React với app).
   * Đo bằng canvas: đỉnh mực của "Ẩ" so với mép trên của span nhãn (overflow:hidden cắt ở đó).
   */
  async function mountButtons(page: Page, injectCss?: string) {
    return page.evaluate(async (css) => {
      const dynImport = new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, unknown>>;
      const urls = performance.getEntriesByType('resource').map((e) => e.name);
      const pick = (re: RegExp) => {
        const u = urls.find((x) => re.test(x));
        if (!u) throw new Error(`Không thấy module ${re}`);
        return u;
      };
      const React = (await dynImport(pick(/\/deps\/react\.js/))) as { default: { createElement: (...a: unknown[]) => unknown } };
      const clientMod = (await dynImport(pick(/\/deps\/react-dom_client\.js/))) as { default?: unknown; createRoot?: unknown };
      const client = (clientMod.createRoot ? clientMod : clientMod.default) as { createRoot: (el: Element) => { render: (n: unknown) => void } };
      const { Button } = (await dynImport('/src/components/ui/button.tsx')) as { Button: unknown };
      if (css) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }
      const host = document.createElement('div');
      host.id = 'btn-harness';
      host.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:99999;background:#fff;display:flex;flex-direction:column;gap:12px;padding:12px';
      document.body.appendChild(host);
      const h = React.default.createElement;
      client.createRoot(host).render(
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(Button, { size: 'md' }, 'Ẩn'),
          h(Button, { size: 'md' }, 'Ấn'),
          h(Button, { size: 'md' }, 'An'),
          h(Button, { size: 'lg' }, 'Ẩn'),
          h(Button, { size: 'lg' }, 'An'),
        ),
      );
      await new Promise((r) => setTimeout(r, 500));
      const canvas = document.createElement('canvas').getContext('2d')!;
      return Array.from(host.querySelectorAll('button')).map((btn) => {
        const label = btn.querySelector('.zaui-btn-container > span:not(.zaui-btn-icon)') as HTMLElement;
        const text = label.textContent ?? '';
        const cs = getComputedStyle(label);
        canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const ascent = canvas.measureText(text.charAt(0)).actualBoundingBoxAscent;
        const probe = document.createElement('i');
        probe.style.cssText = 'display:inline-block;width:0;height:0';
        label.appendChild(probe);
        const baseline = probe.getBoundingClientRect().bottom;
        probe.remove();
        const clipTop = label.getBoundingClientRect().top; // mép trên vùng đệm = nơi overflow:hidden cắt
        return { text, height: btn.getBoundingClientRect().height, inkTop: baseline - ascent, clipTop, ascent, font: canvas.font };
      });
    }, injectCss);
  }

  test('375px: "Ẩn"/"Ấn" không bị cắt đỉnh chữ, chiều cao nút không đổi so với nhãn thường, ≥ 44px', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    mockBuyFlowSession(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });

    const [an2, an3, plain, lgAn2, lgPlain] = await mountButtons(page);
    await page.locator('#btn-harness').screenshot({ path: test.info().outputPath('button-diacritics-375.png') });
    test.info().annotations.push({ type: 'diacritics', description: JSON.stringify({ an2, an3, plain, lgAn2, lgPlain }) });

    for (const b of [an2!, an3!, lgAn2!]) {
      expect(b.inkTop, `"${b.text}" bị cắt đỉnh (mực ${b.inkTop}px < mép cắt ${b.clipTop}px, ${b.font})`).toBeGreaterThanOrEqual(b.clipTop - 0.5);
    }
    expect(an2!.height).toBe(plain!.height);
    expect(an3!.height).toBe(plain!.height);
    expect(lgAn2!.height).toBe(lgPlain!.height);
    expect(plain!.height).toBeGreaterThanOrEqual(44);
    expect(lgPlain!.height).toBeGreaterThanOrEqual(48);
  });

  test('đối chứng: bỏ đệm bù (padding/margin-block) thì "Ẩn" BỊ cắt → phép đo phân biệt được lỗi', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    mockBuyFlowSession(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });

    const [an2] = await mountButtons(
      page,
      '.tubu-btn .zaui-btn-container > span:not(.zaui-btn-icon){padding-block:0 !important;margin-block:0 !important}',
    );
    expect(an2!.inkTop, `không có đệm mà vẫn không bị cắt (mực ${an2!.inkTop}px, mép ${an2!.clipTop}px) — phép đo không nhạy`).toBeLessThan(an2!.clipTop - 0.5);
  });
});

/**
 * tubu-w19-01: màn Đặt hàng thành công của Mini App cùng bố cục MobileSuccess của web (order-success-fold.web.spec.ts). Khi mọi khối phụ cùng hiện
 * (COD, điểm, Giao dự kiến, kết bạn Zalo, Đặt định kỳ, mời bạn), ở 375×812 trạng thái đơn, mã đơn và nút "Theo dõi đơn" nằm trọn trong màn đầu,
 * không nút nào trùng tên, mọi chỗ chạm cao ≥ 44px, không tràn ngang. API mock toàn bộ.
 */
test.describe('tubu-w19-01 Mini: màn Đặt hàng thành công gọn ở 375×812 như web', () => {
  const CARD = { referralCode: 'LAN2026', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
  const SPLIT = [
    { code: 'TUBU-SPLIT-1', total: 149_000, fulfillerName: 'Tubu Tree', pointsEarned: 14 },
    { code: 'TUBU-SPLIT-2', total: 89_000, fulfillerName: 'Gian hàng Lan', pointsEarned: 8 },
    { code: 'TUBU-SPLIT-3', total: 59_000, fulfillerName: 'Gian hàng Minh', pointsEarned: 5 },
  ];

  async function placeWithEverything(page: Page, api: MockApi, split = false) {
    await mockCheckoutWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    api.get('/config/public', {
      ...publicConfig({ shippingEta: { minDays: 1, maxDays: 3 } } as never),
      orderZaloEnabled: true,
      tubuZaloPhone: '0984606774',
      referralViralEnabled: true,
    });
    api.get('/me/green-card', CARD);
    api.post('/events', { accepted: 1 });
    api.get('/config/order-zalo', ORDER_ZALO_STATUS);
    api.allowUnmocked('GET /checkout/shipping-estimate');
    api.post('/checkout/place-order', ({ call }) => ({
      ...placedOrderFor((call.body ?? {}) as Record<string, unknown>),
      orderZaloConsent: true,
      pointsEarned: 120,
      ...(split ? { code: SPLIT[0]!.code, splitOrders: SPLIT } : {}),
    }));
    await openCheckoutState(page, 'miniapp', 375);
    const place = page.getByRole('button', { name: /Đặt hàng · / }).last();
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await place.click();
    await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 15_000 });
  }

  /** Đáy vùng nhìn thấy: chiều cao màn trừ thanh cố định dưới đáy (nếu có). */
  async function foldBottom(page: Page): Promise<number> {
    return page.evaluate(() => {
      const h = window.innerHeight;
      let bottom = h;
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.width > window.innerWidth / 2 && r.bottom >= h - 1 && r.top > h / 2) bottom = Math.min(bottom, r.top);
      }
      return bottom;
    });
  }

  test('đủ khối phụ: trạng thái, mã đơn và Theo dõi đơn nằm trong màn đầu; dữ kiện thanh toán còn nguyên; khối phụ nằm dưới nút', async ({ page, api }) => {
    await placeWithEverything(page, api);
    const view = page.getByTestId('order-success');
    await expect(view.getByTestId('order-invite-nudge')).toBeVisible({ timeout: 10_000 });
    const subscribe = view.getByRole('button', { name: /Đặt định kỳ/ });
    await expect(subscribe).toBeVisible();

    const fold = await foldBottom(page);
    const heading = (await view.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' }).boundingBox())!;
    const code = (await view.getByText(ORDER_CODE_COD, { exact: true }).boundingBox())!;
    const track = (await view.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(0);
    expect(code.y + code.height).toBeLessThanOrEqual(fold);
    expect(track.y + track.height, `Theo dõi đơn phải nằm trong màn đầu (đáy ${fold}px), đang ở ${track.y + track.height}`).toBeLessThanOrEqual(fold);

    await expect(view.getByText('Tổng thanh toán')).toBeVisible();
    await expect(view.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeVisible();
    await expect(view.getByText('+120 điểm, về khi đơn giao xong')).toBeVisible();
    await expect(view.getByText('Giao dự kiến')).toBeVisible();

    const keep = (await view.getByRole('button', { name: 'Tiếp tục mua sắm' }).boundingBox())!;
    const steps = (await view.getByRole('region', { name: 'Tiếp theo' }).boundingBox())!;
    expect(steps.y, 'Tiếp theo nằm dưới hai nút chính').toBeGreaterThan(keep.y + keep.height - 1);
    for (const extra of [view.getByRole('button', { name: 'Mở Zalo Tubu Tree', exact: true }), subscribe, view.getByTestId('order-invite-nudge')]) {
      const box = (await extra.boundingBox())!;
      expect(box.y).toBeGreaterThan(steps.y + steps.height - 1);
    }

    const controls = await view.locator('a, button').evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        })
        .map((el) => ({ name: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(), height: el.getBoundingClientRect().height })),
    );
    const names = controls.map((c) => c.name);
    expect(new Set(names).size, `nút trùng tên: ${JSON.stringify(names)}`).toBe(names.length);
    for (const c of controls) expect(c.height, `"${c.name}" cao ${c.height}px`).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath('order-success-375x812.png') });
  });

  test('đơn tách 3 nơi giao: đủ 3 mã và tổng của cả lần đặt, Theo dõi đơn vẫn trong màn đầu, mỗi đơn mở được', async ({ page, api }) => {
    await placeWithEverything(page, api, true);
    const view = page.getByTestId('order-success');
    for (const o of SPLIT) await expect(view.getByText(o.code, { exact: true }).first()).toBeVisible();
    await expect(view.getByText('Tổng 3 đơn')).toBeVisible();
    await expect(view.getByText('297.000đ').first()).toBeVisible();
    const track = (await view.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
    const fold = await foldBottom(page);
    expect(track.y + track.height, `Theo dõi đơn phải nằm trong màn đầu (đáy ${fold}px)`).toBeLessThanOrEqual(fold);
    for (const o of SPLIT) {
      const row = view.getByRole('button', { name: new RegExp(`Xem đơn ${o.code}`) });
      await expect(row).toBeVisible();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath('order-success-split-375x812.png'), fullPage: true });
    await view.getByRole('button', { name: new RegExp(`Xem đơn ${SPLIT[1]!.code}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${SPLIT[1]!.code}$`));
  });
});
