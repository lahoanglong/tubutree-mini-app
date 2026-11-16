import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockWorld, worldFor } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { ORDER_CODE_COD } from './support/checkout-mocks';
import { singleVariationProduct, type PdpProduct } from './support/pdp-product';

/**
 * Phễu mua của web ở khổ điện thoại 390px: khách chưa đăng nhập mở Trang chủ rồi trang sản phẩm, đăng nhập (giả lập: dấu phiên + /auth/refresh mock),
 * thêm vào giỏ, mở giỏ, vào thanh toán và đặt đơn. Sự kiện tới `/api/events/web` (lô JSON) hoặc `/api/events/web/beacon` (khi trang bị ẩn) phải đúng
 * thứ tự phễu, cùng một phiên và một mã khách ẩn danh, lúc chưa đăng nhập không kèm Authorization, và không mang tên hay số điện thoại của khách.
 * Phần server của Next gọi API thật (sản phẩm một phân loại có sẵn trong DB e2e); mọi lời gọi từ trình duyệt đi qua mock.
 */

interface SentEvent {
  eventName: string;
  occurredAt: string;
  platform: string;
  anonymousId: string;
  sessionId: string;
  props: Record<string, unknown>;
}

interface Batch {
  events: SentEvent[];
  auth: boolean;
}

function batches(api: MockApi): Batch[] {
  const json = api
    .callsTo('POST', '/events/web')
    .map((c) => ({ events: (c.body as { events: SentEvent[] }).events, auth: !!c.headers['authorization'] }));
  const beacon = api.callsTo('POST', '/events/web/beacon').map((c) => {
    const payload = new URLSearchParams(String(c.body)).get('payload') ?? '{"events":[]}';
    return { events: (JSON.parse(payload) as { events: SentEvent[] }).events, auth: !!c.headers['authorization'] };
  });
  return [...json, ...beacon];
}

/** Mọi sự kiện đã gửi, theo giờ phát (sort ổn định giữ thứ tự trong lô khi trùng mốc). */
const sent = (api: MockApi): SentEvent[] =>
  batches(api)
    .flatMap((b) => b.events)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

/** Tên kèm bước/hành động để so thứ tự phễu bằng một mảng chuỗi. */
const label = (e: SentEvent): string =>
  e.eventName === 'checkout_step' ? `checkout_step:${String(e.props.step)}` : e.eventName === 'pdp_action' ? `pdp_action:${String(e.props.action)}` : e.eventName;

/** Hàng đợi web xả khi trang bị ẩn: giả lập một lần ẩn rồi trả lại trạng thái thật để app chạy tiếp như thường. */
async function flushEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });
}

function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) if (h === needle[i]) i++;
  return i === needle.length;
}

function mockGuestPages(api: MockApi, p: PdpProduct): void {
  api.get('/flash-sales/active', []);
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.allowUnmocked('GET /affiliate/me', 'GET /products/:slug/reviews/can-review', 'POST /coupons/preview', 'GET /coupons/available', 'POST /affiliate/touch');
}

const addButton = (page: Page) => page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');

test.describe('Web 390: phễu mua gửi đủ sự kiện', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ 390 do spec tự đặt, một project là đủ');
  });

  test('Trang chủ → sản phẩm → đăng nhập → giỏ → thanh toán → đặt đơn', async ({ page, api, request }) => {
    const p = await singleVariationProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào chỉ một phân loại');
    mockGuestPages(api, p!);
    await page.setViewportSize({ width: 390, height: 844 });

    // Khách chưa đăng nhập: Trang chủ rồi trang sản phẩm.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await flushEvents(page);
    await expect.poll(() => sent(api).map((e) => e.eventName), { timeout: 10_000 }).toContain('screen_viewed');
    await page.goto(`/san-pham/${p!.slug}`);
    await expect(addButton(page)).toBeVisible({ timeout: 30_000 });
    await flushEvents(page);
    await expect.poll(() => sent(api).map((e) => e.eventName), { timeout: 10_000 }).toContain('product_viewed');
    expect(
      batches(api).every((b) => !b.auth),
      'Sự kiện của khách chưa đăng nhập không kèm Authorization',
    ).toBe(true);
    const guest = sent(api);
    expect(guest.find((e) => e.eventName === 'screen_viewed')?.props).toEqual({ route: '/', referrerRoute: null });
    expect(guest.find((e) => e.eventName === 'product_viewed')?.props).toMatchObject({ productSlug: p!.slug });
    expect(guest.some((e) => e.eventName === 'screen_viewed' && e.props.route === '/san-pham/:slug')).toBe(true);

    // Đăng nhập giả lập: từ giờ mọi lần mở trang có dấu phiên, /auth/refresh trả tài khoản; mở lại trang sản phẩm.
    const world = worldFor(FLOW_PLAIN);
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    api.post('/cart/items', world.cart);
    await page.reload();
    const add = addButton(page);
    await expect(add).toBeEnabled({ timeout: 30_000 });
    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    await posted;

    // Giỏ → Thanh toán (từ giỏ, đủ món) → Đặt hàng.
    await page.goto('/gio-hang');
    const pay = page.getByTestId('sticky-bar').getByRole('link', { name: /^Thanh toán/ });
    await expect(pay).toBeVisible({ timeout: 15_000 });
    await pay.click();
    await page.waitForURL('**/thanh-toan');
    const place = page.getByRole('button', { name: /Đặt hàng · / }).last();
    await expect(place).toBeEnabled({ timeout: 15_000 });
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await place.click();
    await placed;
    await expect(page.getByTestId('order-success-mobile').getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
    await flushEvents(page);

    const funnel = [
      'screen_viewed',
      'product_viewed',
      'pdp_action:add_to_cart',
      'cart_viewed',
      'checkout_started',
      'checkout_step:address_saved',
      'checkout_step:shipping_quote_shown',
      'checkout_step:place_order_click',
    ];
    await expect
      .poll(() => isSubsequence(funnel, sent(api).map(label)), { timeout: 10_000, message: `Thứ tự sự kiện: ${sent(api).map(label).join(', ')}` })
      .toBe(true);

    const all = sent(api);
    expect(all.map(label)).not.toContain('checkout_abandoned');
    expect(new Set(all.map((e) => e.sessionId)).size, 'Cả hành trình là một phiên').toBe(1);
    expect(new Set(all.map((e) => e.anonymousId)).size, 'Một mã khách ẩn danh cho cả trước và sau đăng nhập').toBe(1);
    expect(all.every((e) => e.platform === 'web')).toBe(true);
    expect(all.find((e) => e.eventName === 'checkout_started')?.props).toEqual({ entry: 'cart', itemCount: world.cart.items.length });
    expect(all.find((e) => e.eventName === 'cart_viewed')?.props).toMatchObject({ itemCount: world.cart.items.length });
    expect(all.find((e) => label(e) === 'pdp_action:add_to_cart')?.props).toEqual({ action: 'add_to_cart', productSlug: p!.slug });
    const routes = all.filter((e) => e.eventName === 'screen_viewed').map((e) => e.props.route);
    expect(routes).toEqual(expect.arrayContaining(['/', '/san-pham/:slug', '/gio-hang', '/thanh-toan']));
    const raw = JSON.stringify(all);
    expect(raw).not.toContain('Nguyễn Văn A');
    expect(raw).not.toContain('0901234567');
    expect(raw).not.toContain(ORDER_CODE_COD);
  });
});
