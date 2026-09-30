import { test, expect, makeOrder, reply, type MockApi, type MockHandler } from './support/mock-api';
import type { Page } from '@playwright/test';
import { DELIVERED_CODE, PURCHASED, PURCHASED_PAGE, REMINDER, THUMB, mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';
import { mockCheckout, publicConfig, ORDER_CODE_COD } from './support/checkout-mocks';
import { PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

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

/** Hàng đợi sự kiện chỉ xả khi app bị ẩn (hoặc mỗi 10s) — ép xả để các lô /events tới mock ngay. */
async function flushEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Mọi sự kiện analytics đã tới mock (cần `api.post('/events', ...)`) có tên `eventName`. */
function eventsNamed(api: MockApi, eventName: string): { eventName: string; props: Record<string, unknown>; notificationId?: string }[] {
  return api
    .callsTo('POST', '/events')
    .flatMap((c) => (c.body as { events: { eventName: string; props: Record<string, unknown>; notificationId?: string }[] }).events)
    .filter((e) => e.eventName === eventName);
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
    await expect(page.getByRole('heading', { name: 'Đơn hàng' })).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible({ timeout: 15_000 });
  });

  test('/subscriptions (link cũ) → /orders?tab=subscriptions, tab Định kỳ đang chọn', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/subscriptions');
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
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
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible({ timeout: 15_000 });

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

  const EMPTY_PAGE = { items: [], nextCursor: null };
  const noSheetCases = [
    { name: 'tra cứu 404 (API cũ) + có slug → trang sản phẩm', purchased: NOT_FOUND, slug: true, to: PDP_SLUG_PATH },
    { name: 'SP không còn trong danh sách đã mua + có slug → trang sản phẩm', purchased: EMPTY_PAGE, slug: true, to: PDP_SLUG_PATH },
    { name: 'tra cứu 404 (API cũ) + thiếu slug → tab Đơn hàng', purchased: NOT_FOUND, slug: false, to: '/orders' },
    { name: 'SP không còn trong danh sách đã mua + thiếu slug → tab Đơn hàng', purchased: EMPTY_PAGE, slug: false, to: '/orders' },
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

  test('Đặt hàng thành công (DS v2): mã đơn sao chép được, tổng, điểm, giao dự kiến, 3 bước, gợi ý định kỳ; không lá rơi', async ({ page, api }) => {
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
    await expect(page.getByText('+14 điểm')).toBeVisible();
    await expect(page.getByText('Giao dự kiến')).toBeVisible();
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) {
      await expect(page.getByText(s, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Đặt định kỳ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Theo dõi đơn' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếp tục mua sắm' })).toBeVisible();
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
      const card = page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` });
      await expect(card).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll()).toBe(true);
      await card.getByRole('button', { name: 'Mua lại', exact: true }).click();
      const cta = page.getByRole('button', { name: 'Thêm vào giỏ (2)' });
      await expect(cta).toBeVisible();
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
      for (const name of ['Theo dõi đơn', 'Tiếp tục mua sắm', 'Đặt định kỳ', 'Sao chép mã đơn']) {
        const b = await page.getByRole('button', { name }).boundingBox();
        expect(b, name).not.toBeNull();
        expect(b!.x, `${name} tràn trái`).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`order-success-${width}.png`), fullPage: true });
    });
  }

  test('Chi tiết đơn 320px (followups DS v2): "Hủy đơn" + "Thanh toán ngay" nằm trọn và không bị cắt chữ', async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    mockBuyFlowSession(api);
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PAY-320', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' }));
    await page.goto('/order/TUBU-PAY-320');

    const bar = page.getByTestId('sticky-bar');
    for (const name of ['Hủy đơn', 'Thanh toán ngay']) {
      const btn = bar.getByRole('button', { name });
      await expect(btn).toBeVisible({ timeout: 15_000 });
      const b = await btn.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(320);
      expect(b!.height, `${name} thấp hơn vùng chạm 44px`).toBeGreaterThanOrEqual(44);
      const label = btn.getByText(name, { exact: true });
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), `"${name}" bị rút gọn`).toBe(true);
    }
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
