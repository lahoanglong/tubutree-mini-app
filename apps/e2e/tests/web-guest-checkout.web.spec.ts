import type { APIRequestContext, Page, Request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, publicConfig, reply, type MockApi } from './support/mock-api';
import { serverGuestCheckoutReady, setServerGuestCheckout } from './support/guest-checkout-flag';
import { assertProductOnCi, singleVariationProduct } from './support/pdp-product';
import { probeW182 } from './support/w182-probe';

/**
 * Đặt hàng trên web không đăng nhập (cờ `web.guest_checkout_enabled`). Cờ bật: khách đi trang sản phẩm → Mua ngay (đi thẳng thanh toán, không qua giỏ) → một biểu mẫu
 * (tên, SĐT, tỉnh, phường, số nhà) → đơn COD → trang theo dõi `/don/<mã>#k=<khoá>`; COD trên trần thì chỉ còn chuyển khoản và sang trang QR kèm khoá.
 * Cờ tắt: giỏ và thanh toán như bản trước (tường đăng nhập), không gọi thêm đường nào; ca này ghi danh sách request và ảnh vào
 * GUEST_CHECKOUT_COMPARE_DIR/<GUEST_CHECKOUT_COMPARE_LABEL> để so với cùng ca chạy trên main.
 * Phần server của Next gọi API thật (sản phẩm một phân loại trong DB e2e); mọi lời gọi từ trình duyệt đi qua mock. Layout `/don/[code]` đọc cờ ở máy
 * chủ và trả 404 khi cờ tắt, nên ca nào mở `/don` bật cờ thật trong DB tạm ngay trước lúc đó (support/guest-checkout-flag.ts) và tắt lại sau ca.
 */

const NEEDS_TEMP_DB = 'trang /don đọc cờ ở máy chủ: cần DB tạm của web-gate.sh (hoặc job CI) và một worker để bật cờ thật';

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const SHOTS_DIR = process.env.GUEST_CHECKOUT_SHOTS_DIR;
const COMPARE_DIR = process.env.GUEST_CHECKOUT_COMPARE_DIR;
const COMPARE_LABEL = process.env.GUEST_CHECKOUT_COMPARE_LABEL ?? 'after';
const SIZES = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const PROVINCE = { code: '84_VN79', name: 'TP. Hồ Chí Minh' };
const WARD = { code: '84_VN7901', name: 'Phường Bến Thành' };
const CODE = 'TUBU2026111800042';
const GUEST_CART_KEY = 'tubu.guestCart.v1';
const GUEST_DRAFT_KEY = 'tubu.guestCheckout.draft';
const LOOKUP_PHONE = '0912345678';
/** Khoá tạm máy chủ cấp khi tra đúng mã + SĐT: cùng khuôn 43 ký tự base64url với khoá trình duyệt tự sinh. */
const LOOKUP_KEY = 'L'.repeat(43);

interface Detail {
  slug: string;
  name: string;
  thumbnail: string | null;
  variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[];
}

async function inStockProduct(request: APIRequestContext): Promise<Detail | null> {
  const p = await singleVariationProduct(request);
  assertProductOnCi(p, 'sản phẩm một phân loại');
  if (!p || (p.variations[0]?.stock ?? 0) <= 0) return null;
  const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(p.slug)}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as Detail) : null;
}

const unitOf = (d: Detail) => d.variations[0]!.salePrice ?? d.variations[0]!.retailPrice;

function config(flagOn: boolean, extra: Record<string, unknown> = {}) {
  return {
    ...publicConfig(),
    freeshipThreshold: 199000,
    webGuestCartEnabled: true,
    ...(flagOn ? { webGuestCheckoutEnabled: true, newCustomer: { welcomeVoucher: { amount: 30000 } } } : {}),
    ...extra,
  };
}

function mockShop(api: MockApi, d: Detail, flagOn: boolean, extra: Record<string, unknown> = {}): void {
  api.get('/config/public', config(flagOn, extra));
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get(`/products/${d.slug}`, d);
  api.get(`/products/${d.slug}/related`, []);
  api.get(`/products/${d.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get(`/products/${d.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/geo/provinces', [PROVINCE]);
  api.get('/geo/communes', [WARD]);
  api.allowUnmocked('GET /affiliate/me', 'GET /products/:slug/reviews/can-review', 'POST /coupons/preview', 'GET /coupons/available', 'POST /affiliate/touch', 'GET /me/wishlist/ids', 'GET /products', 'GET /dang-nhap');
}

interface QuoteOpts {
  codBlocked?: boolean;
}

function quoteFor(d: Detail, quantity: number, opts: QuoteOpts = {}) {
  const v = d.variations[0]!;
  const unit = unitOf(d);
  const subtotal = unit * quantity;
  const shippingFee = subtotal >= 199000 ? 0 : 19000;
  return {
    flashNotice: false,
    blockedPaymentMethods: opts.codBlocked ? { COD: 'Đơn trên 500.000đ chưa đăng nhập chỉ nhận chuyển khoản.' } : {},
    codMax: 500000,
    subtotal,
    discount: 0,
    comboDiscount: 0,
    shippingFee,
    total: subtotal + shippingFee,
    items: [{ id: v.id, variationId: v.id, productName: d.name, variationName: v.name, slug: d.slug, thumbnail: d.thumbnail, unitPrice: unit, quantity, total: subtotal }],
  };
}

/**
 * Đơn đã đặt ghi khoá theo dõi gửi lên; GET theo dõi chỉ trả đơn khi header `x-order-key` đúng khoá đó (hoặc khoá tạm đã cấp qua tra cứu mã + SĐT),
 * sai thì cùng 404 như mã không có. `method` đặt sẵn phương thức của đơn khi spec tra cứu mà không đặt đơn trước.
 */
function mockGuestOrders(
  api: MockApi,
  d: Detail,
  opts: QuoteOpts & { method?: 'COD' | 'BANK_TRANSFER'; zaloFriendCard?: boolean } = {},
): { key: () => string | null } {
  let key: string | null = null;
  let lookupIssued = false;
  let method: 'COD' | 'BANK_TRANSFER' = opts.method ?? 'COD';
  const keyOk = (header: string | undefined) => (!!key && header === key) || (lookupIssued && header === LOOKUP_KEY);
  api.post('/checkout/guest/quote', ({ call }) => {
    const body = call.body as { lines: { quantity: number }[] };
    return quoteFor(d, body.lines[0]!.quantity, opts);
  });
  api.post('/checkout/guest/orders', ({ call }) => {
    const body = call.body as { trackingKey: string; paymentMethod: 'COD' | 'BANK_TRANSFER'; lines: { quantity: number }[] };
    key = body.trackingKey;
    method = body.paymentMethod;
    const q = quoteFor(d, body.lines[0]!.quantity, opts);
    return { code: CODE, status: method === 'COD' ? 'CONFIRMED' : 'PENDING_PAYMENT', paymentMethod: method, total: q.total, codes: [CODE], keyAccepted: true };
  });
  const notFound = reply(404, { statusCode: 404, message: 'Không tìm thấy đơn hàng.' });
  const view = () => {
    const q = quoteFor(d, 1, opts);
    return {
      code: CODE,
      status: method === 'COD' ? 'CONFIRMED' : 'PENDING_PAYMENT',
      paymentMethod: method,
      paymentStatus: 'UNPAID',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      statusTimes: {},
      subtotal: q.subtotal,
      discount: 0,
      shippingFee: q.shippingFee,
      total: q.total,
      items: [{ productName: d.name, variationName: d.variations[0]!.name, quantity: 1, unitPrice: unitOf(d), total: q.subtotal, isGift: false }],
      phoneMasked: '091****678',
      area: { ward: WARD.name, province: PROVINCE.name },
      siblings: [],
      expiresAt: null,
      ...(opts.zaloFriendCard ? { zaloFriendCard: true } : {}),
    };
  };
  api.get('/checkout/guest/orders/:code', ({ call, params }) => {
    if (params.code !== CODE || !keyOk(call.headers['x-order-key'])) return notFound;
    return view();
  });
  api.post('/checkout/guest/lookup', ({ call }) => {
    const body = call.body as { orderCode: string; phone: string };
    if (body.orderCode !== CODE || body.phone !== LOOKUP_PHONE) return reply(404, { statusCode: 404, message: 'Không tìm thấy đơn khớp mã đơn và số điện thoại này.' });
    lookupIssued = true;
    return {
      order: view(),
      trackingKey: LOOKUP_KEY,
      trackPath: `/don/${CODE}#k=${LOOKUP_KEY}`,
      bankPath: method === 'BANK_TRANSFER' ? `/thanh-toan/chuyen-khoan/${CODE}#k=${LOOKUP_KEY}` : null,
      linkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  });
  api.get('/checkout/guest/orders/:code/bank-qr', ({ call, params }) => {
    if (params.code !== CODE || !keyOk(call.headers['x-order-key'])) return notFound;
    const q = quoteFor(d, 1, opts);
    return {
      orderCode: CODE,
      amount: q.total,
      paymentStatus: 'UNPAID',
      paymentDeadline: null,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: CODE,
      qrString: 'x',
      qrImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    };
  });
  return { key: () => key };
}

/** Giỏ khách có sẵn một dòng (spec không đi qua trang sản phẩm). */
async function seedGuestCart(page: Page, d: Detail, quantity: number): Promise<void> {
  const line = { variationId: d.variations[0]!.id, slug: d.slug, quantity, addedAt: 1 };
  await page.addInitScript(
    ([k, value]) => {
      try {
        if (!localStorage.getItem(k!)) localStorage.setItem(k!, value!);
      } catch {
        // không có localStorage: giỏ trống
      }
    },
    [GUEST_CART_KEY, JSON.stringify([line])],
  );
  // Giỏ khách ghi món luôn đặt kèm cookie này (lib/guest-cart/store.ts); thiếu nó middleware phục vụ bản dựng sẵn giỏ trống của /gio-hang.
  await page.context().addCookies([{ name: 'tubu_guest_cart', value: '1', domain: 'localhost', path: '/' }]);
}

const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`).first();

async function shoot(page: Page, dir: string | undefined, name: string): Promise<void> {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // Ảnh toàn trang vẽ nút Quay lại (fixed) tại vị trí cuộn hiện tại: còn cuộn thì nút nằm đè giữa biểu mẫu trong ảnh.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

/** Đếm từng lần chạm của khách (bấm, chạm vào ô để gõ); gõ chữ trong ô đang chọn không tính thêm. */
function tapCounter(page: Page) {
  let taps = 0;
  return {
    get count() {
      return taps;
    },
    async click(target: ReturnType<Page['locator']>) {
      taps++;
      await target.click();
    },
    async fill(target: ReturnType<Page['locator']>, value: string) {
      taps++;
      await target.click();
      await target.fill(value);
    },
  };
}

async function fillContactAndAddress(page: Page, tap: ReturnType<typeof tapCounter>, phone = '0912345678'): Promise<void> {
  const form = page.getByTestId('guest-checkout');
  await tap.fill(form.getByLabel('Họ tên người nhận'), 'Nguyễn Văn An');
  await tap.fill(form.getByLabel('Số điện thoại', { exact: true }), phone);
  await tap.click(form.getByLabel('Tỉnh/Thành phố'));
  await tap.click(page.getByRole('option', { name: PROVINCE.name }));
  // Chọn tỉnh xong sheet Phường/Xã tự mở.
  await tap.click(page.getByRole('option', { name: WARD.name }));
  await expect(form.getByLabel('Phường/Xã')).toContainText(WARD.name);
  await tap.fill(form.getByLabel('Số nhà, tên đường'), '12 Lê Lợi');
}

test.describe('Đặt hàng không đăng nhập trên web, cờ bật', () => {
  test.afterEach(async ({ request }) => {
    await setServerGuestCheckout(request, false);
  });

  test('trang sản phẩm → Mua ngay → một biểu mẫu → đơn COD → trang theo dõi, đúng 8 chạm', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    mockShop(api, d!, true);
    const orders = mockGuestOrders(api, d!);
    const tap = tapCounter(page);

    await page.goto(`/san-pham/${d!.slug}`);
    const buy = mobile ? page.getByTestId('buy-now') : page.getByTestId('pdp-buy-now');
    await expect(buy).toBeEnabled({ timeout: 30_000 });
    const visited: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    });
    await tap.click(buy);
    await page.waitForURL('**/thanh-toan', { timeout: 15_000 });
    expect(visited, 'cờ đặt hàng không đăng nhập bật: Mua ngay đi thẳng thanh toán, không qua giỏ').not.toContain('/gio-hang');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('guest-login-link')).toHaveText(/30\.000đ/);
    expect(page.url()).not.toContain('/dang-nhap');

    await fillContactAndAddress(page, tap);
    const place = visible(page, 'guest-place-order');
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('guest-total')).toHaveText(new RegExp(quoteFor(d!, 1).total.toLocaleString('vi-VN').replace(/\./g, '\\.')));
    await setServerGuestCheckout(request, true);
    await tap.click(place);

    await page.waitForURL(new RegExp(`/don/${CODE}#k=[A-Za-z0-9_-]{43}$`), { timeout: 20_000 });
    expect(tap.count, 'số chạm từ trang sản phẩm tới lúc đặt xong').toBe(8);

    const placed = api.callsTo('POST', '/checkout/guest/orders');
    expect(placed).toHaveLength(1);
    const body = placed[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      lines: [{ variationId: d!.variations[0]!.id, quantity: 1 }],
      address: {
        recipient: 'Nguyễn Văn An',
        phone: '0912345678',
        province: PROVINCE.name,
        provinceCode: PROVINCE.code,
        ward: WARD.name,
        wardCode: WARD.code,
        street: '12 Lê Lợi',
      },
      paymentMethod: 'COD',
      expectedTotal: quoteFor(d!, 1).total,
      website: '',
    });
    expect(typeof body.fillMs).toBe('number');
    expect(placed[0]!.headers['idempotency-key']).toBeTruthy();
    expect(placed[0]!.headers['x-guest-device']).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(placed[0]!.headers.authorization).toBeUndefined();
    expect(new URL(page.url()).hash).toBe(`#k=${orders.key()}`);

    await expect(page.getByTestId('guest-order-phone')).toContainText('091****678', { timeout: 15_000 });
    await expect(page.getByText(WARD.name).first()).toBeVisible();
    await expect(page.getByText('12 Lê Lợi')).toHaveCount(0);
    await expect(page.getByTestId('guest-order-copy-link')).toBeVisible();
    await expect(page.getByTestId('guest-order-claim-link')).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent(`/don/${CODE}`)}`);
    await expect(page.getByTestId('guest-order-zalo-friend')).toHaveCount(0);
    const track = api.callsTo('GET', '/checkout/guest/orders/:code');
    expect(track.length).toBeGreaterThan(0);
    expect(track[0]!.headers['x-order-key']).toBe(orders.key());
    expect(await page.evaluate((k) => localStorage.getItem(k), GUEST_CART_KEY)).toBeNull();
    const saved = await page.evaluate(() => localStorage.getItem('tubu.guestCheckout.orders'));
    expect(JSON.parse(saved ?? '{}')[CODE]?.k).toBe(orders.key());
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
    if (mobile) await shoot(page, SHOTS_DIR, 'after-track-390');
  });

  test('SĐT bàn báo lỗi tại ô; COD trên trần chỉ còn chuyển khoản và sang trang QR kèm khoá', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    mockShop(api, d!, true);
    const qty = Math.min(d!.variations[0]!.stock, Math.ceil(510000 / unitOf(d!)));
    test.skip(unitOf(d!) * qty <= 500000, 'tồn kho không đủ để vượt trần COD');
    const orders = mockGuestOrders(api, d!, { codBlocked: true });
    await seedGuestCart(page, d!, qty);
    const tap = tapCounter(page);

    await page.goto('/thanh-toan');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 15_000 });
    const phone = page.getByTestId('guest-checkout').getByLabel('Số điện thoại', { exact: true });
    await phone.fill('0281234567');
    await phone.blur();
    await expect(page.getByText('Số di động gồm 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.')).toBeVisible();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await phone.fill('');

    await fillContactAndAddress(page, tap, '0987654321');
    await expect(page.getByTestId('guest-pay-blocked-COD')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('radio', { name: /Chuyển khoản/ })).toBeChecked();
    if (mobile) await shoot(page, SHOTS_DIR, 'after-cod-over-max-390');
    const place = visible(page, 'guest-place-order');
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await place.click();

    await page.waitForURL(new RegExp(`/thanh-toan/chuyen-khoan/${CODE}#k=[A-Za-z0-9_-]{43}$`), { timeout: 20_000 });
    expect((api.callsTo('POST', '/checkout/guest/orders')[0]!.body as { paymentMethod: string }).paymentMethod).toBe('BANK_TRANSFER');
    await expect(page.getByRole('heading', { name: 'Quét QR để chuyển khoản' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('9984606774').first()).toBeVisible();
    expect(api.callsTo('GET', '/checkout/guest/orders/:code/bank-qr')[0]!.headers['x-order-key']).toBe(orders.key());
    expect(api.callsTo('GET', '/payments/bank-qr/:code')).toHaveLength(0);
  });

  test('ô nhận hành trình đơn qua Zalo (PO A2): cổng mở cho mọi khách thì hiện với số khách gõ, vùng chạm 44px, không công tắc người nhận; tick rồi đặt gửi orderZaloConsent: true', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    const width = mobile ? 390 : 1440;
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    mockShop(api, d!, true, { orderZaloEnabled: true, orderZaloGuest: true, orderZaloPrechecked: false, tubuZaloPhone: '0899149229' });
    mockGuestOrders(api, d!, { zaloFriendCard: true });
    await seedGuestCart(page, d!, 1);

    await page.goto('/thanh-toan');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 15_000 });
    const box = page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
    await expect(box).toHaveCount(0);
    await fillContactAndAddress(page, tapCounter(page));
    const row = page.locator('label').filter({ has: box });
    await expect(row).toContainText('Số nhận: 091•••5678');
    await expect(box).not.toBeChecked();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByTestId('order-zalo-recipient')).toHaveCount(0);
    if (mobile) await shoot(page, SHOTS_DIR, 'after-order-zalo-390');
    await row.click();
    await expect(box).toBeChecked();

    const place = visible(page, 'guest-place-order');
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await setServerGuestCheckout(request, true);
    await place.click();
    await page.waitForURL(new RegExp(`/don/${CODE}#k=[A-Za-z0-9_-]{43}$`), { timeout: 20_000 });
    const body = api.callsTo('POST', '/checkout/guest/orders')[0]!.body as Record<string, unknown>;
    expect(body.orderZaloConsent).toBe(true);
    expect(body).not.toHaveProperty('notifyRecipientZalo');

    // Trang theo dõi: máy chủ báo zaloFriendCard thì có thẻ mời kết bạn Zalo Tubu Tree (link zalo.me, câu có mã đơn).
    const friend = page.getByTestId('guest-order-zalo-friend');
    await expect(friend).toBeVisible({ timeout: 15_000 });
    await expect(friend).toContainText(`Nhận Bill & theo dõi đơn ${CODE} miễn phí qua Zalo Tubu Tree`);
    await expect(friend.locator('a[href="https://zalo.me/0899149229"]')).toHaveCount(1);
    await expect(friend.getByTestId('order-zalo-friend-qr')).toBeVisible({ visible: !mobile });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (mobile) await shoot(page, SHOTS_DIR, 'don-zalo-friend-390');
  });

  test('/don: sai khoá, thiếu khoá và sai mã cùng một câu không tìm thấy', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    await setServerGuestCheckout(request, true);
    mockShop(api, d!, true);
    mockGuestOrders(api, d!);
    const texts: string[] = [];
    for (const path of [`/don/${CODE}#k=${'A'.repeat(43)}`, `/don/TUBU0000000000000#k=${'B'.repeat(43)}`, `/don/${CODE}`]) {
      await page.goto(path);
      const nf = page.getByTestId('guest-order-not-found');
      await expect(nf).toBeVisible({ timeout: 15_000 });
      texts.push((await nf.textContent()) ?? '');
    }
    expect(new Set(texts).size).toBe(1);
  });

  test('/don tra cứu: từ trang không tìm thấy sang /don?ma= điền sẵn mã; sai SĐT báo một câu chung; đúng SĐT mở trang theo dõi bằng khoá tạm', async ({ page, api, request }, testInfo) => {
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    const mobile = testInfo.project.name === 'Web Customer Mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await setServerGuestCheckout(request, true);
    mockShop(api, d!, true);
    mockGuestOrders(api, d!);

    await page.goto(`/don/${CODE}`);
    await expect(page.getByTestId('guest-order-not-found')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('guest-order-lookup-link').click();
    await page.waitForURL(new RegExp(`/don\\?ma=${CODE}$`), { timeout: 15_000 });
    const codeInput = page.getByTestId('guest-lookup-code');
    await expect(codeInput).toHaveValue(CODE, { timeout: 15_000 });
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
    if (mobile) {
      const p = await probeW182(page, { touch: true, capsule: false });
      expect(p.overflowX, `/don 390px tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      expect(p.small, `/don 390px vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, '/don 390px chữ đè nhau').toEqual([]);
      await shoot(page, SHOTS_DIR, 'after-lookup-390');
    }

    const phone = page.getByTestId('guest-lookup-phone');
    await phone.fill('0987654321');
    await page.getByTestId('guest-lookup-submit').click();
    await expect(page.getByTestId('guest-lookup-error')).toHaveText('Không tìm thấy đơn khớp mã và số điện thoại này. Bạn kiểm tra lại nhé.', { timeout: 15_000 });
    expect(page.url()).toContain('/don?ma=');

    await phone.fill('+84 912 345 678');
    await expect(page.getByTestId('guest-lookup-error')).toHaveCount(0);
    await page.getByTestId('guest-lookup-submit').click();
    await page.waitForURL(new RegExp(`/don/${CODE}#k=${LOOKUP_KEY}$`), { timeout: 20_000 });
    await expect(page.getByTestId('guest-order-phone')).toContainText('091****678', { timeout: 15_000 });
    const lookups = api.callsTo('POST', '/checkout/guest/lookup');
    expect(lookups.map((c) => c.body)).toEqual([
      { orderCode: CODE, phone: '0987654321' },
      { orderCode: CODE, phone: LOOKUP_PHONE },
    ]);
    expect(lookups[1]!.headers.authorization).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('tubu.guestCheckout.orders'))).toBeNull();
  });

  test('/don tra cứu đơn chuyển khoản đang chờ tiền: sang thẳng trang QR bằng khoá tạm', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'một khổ là đủ, luồng như nhau');
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    await setServerGuestCheckout(request, true);
    mockShop(api, d!, true);
    mockGuestOrders(api, d!, { method: 'BANK_TRANSFER' });
    await page.goto('/don');
    await page.getByTestId('guest-lookup-code').fill(` #${CODE.toLowerCase()} `);
    await page.getByTestId('guest-lookup-phone').fill(LOOKUP_PHONE);
    await page.getByTestId('guest-lookup-submit').click();
    await page.waitForURL(new RegExp(`/thanh-toan/chuyen-khoan/${CODE}#k=${LOOKUP_KEY}$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Quét QR để chuyển khoản' })).toBeVisible({ timeout: 15_000 });
    // Tiêu đề hiện trước khi QR về: chờ số tài khoản (chỉ có trong trả lời bank-qr) rồi mới đọc lời gọi.
    await expect(page.getByText('9984606774').first()).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('POST', '/checkout/guest/lookup')[0]!.body).toEqual({ orderCode: CODE, phone: LOOKUP_PHONE });
    expect(api.callsTo('GET', '/checkout/guest/orders/:code/bank-qr')[0]!.headers['x-order-key']).toBe(LOOKUP_KEY);
    await expect(page.locator('button:visible', { hasText: 'Tôi đã chuyển khoản — Kiểm tra ngay' }).first()).toBeVisible();
  });

  test('nháp biểu mẫu: tải lại trang vẫn còn tên, SĐT, tỉnh/phường, số nhà, ghi chú; đặt xong thì xoá', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'một khổ là đủ: nháp không phụ thuộc khổ màn hình');
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    await page.setViewportSize({ width: 390, height: 844 });
    mockShop(api, d!, true);
    mockGuestOrders(api, d!);
    await seedGuestCart(page, d!, 1);

    await page.goto('/thanh-toan');
    const form = page.getByTestId('guest-checkout');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await fillContactAndAddress(page, tapCounter(page));
    await form.getByLabel('Ghi chú cho đơn (không bắt buộc)').fill('Gọi trước khi giao');
    await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), GUEST_DRAFT_KEY)).toContain('Gọi trước khi giao');
    expect(await page.evaluate((k) => localStorage.getItem(k), GUEST_DRAFT_KEY)).toBeNull();

    await page.reload();
    await expect(form).toBeVisible({ timeout: 15_000 });
    await expect(form.getByLabel('Họ tên người nhận')).toHaveValue('Nguyễn Văn An');
    await expect(form.getByLabel('Số điện thoại', { exact: true })).toHaveValue(/0912\s?345\s?678/);
    await expect(form.getByLabel('Phường/Xã')).toContainText(WARD.name);
    await expect(form.getByLabel('Số nhà, tên đường')).toHaveValue('12 Lê Lợi');
    await expect(form.getByLabel('Ghi chú cho đơn (không bắt buộc)')).toHaveValue('Gọi trước khi giao');

    const place = visible(page, 'guest-place-order');
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await place.click();
    await page.waitForURL(new RegExp(`/don/${CODE}#k=`), { timeout: 20_000 });
    expect((api.callsTo('POST', '/checkout/guest/orders')[0]!.body as { address: { street: string } }).address.street).toBe('12 Lê Lợi');
    expect(await page.evaluate((k) => sessionStorage.getItem(k), GUEST_DRAFT_KEY)).toBeNull();
  });

  test('biểu mẫu và trang theo dõi 360/390/768/1440: không tràn ngang, vùng chạm 44px, chữ không đè', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    mockShop(api, d!, true);
    mockGuestOrders(api, d!);
    await seedGuestCart(page, d!, 1);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/thanh-toan');
      await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const p = await probeW182(page, { touch: size.width <= 768, capsule: false });
      expect(p.overflowX, `${size.width}px tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      if (size.width <= 768) expect(p.small, `${size.width}px vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, `${size.width}px chữ đè nhau`).toEqual([]);
      await expect(page.locator('[data-testid="guest-place-order"]:visible'), `${size.width}px đúng một nút Đặt hàng đang hiện`).toHaveCount(1);
      await shoot(page, SHOTS_DIR, `after-form-${size.width}`);
    }
    // Trang theo dõi: đặt một đơn ở khổ điện thoại rồi đo trang /don ở từng khổ.
    await page.setViewportSize(SIZES[1]!);
    await page.goto('/thanh-toan');
    await fillContactAndAddress(page, tapCounter(page));
    const place = visible(page, 'guest-place-order');
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await setServerGuestCheckout(request, true);
    await place.click();
    await page.waitForURL(new RegExp(`/don/${CODE}#k=`), { timeout: 20_000 });
    const trackUrl = page.url();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(trackUrl);
      await expect(page.getByTestId('guest-order-phone')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const p = await probeW182(page, { touch: size.width <= 768, capsule: false });
      expect(p.overflowX, `/don ${size.width}px tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      if (size.width <= 768) expect(p.small, `/don ${size.width}px vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, `/don ${size.width}px chữ đè nhau`).toEqual([]);
      await shoot(page, SHOTS_DIR, `after-track-${size.width}`);
    }
  });
});

test.describe('Đặt hàng không đăng nhập trên web, cờ tắt', () => {
  test('giỏ và thanh toán như cũ: tường đăng nhập, không gọi đường checkout/guest (ghi request và ảnh để so với main)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
    const d = await inStockProduct(request);
    test.skip(!d, 'DB e2e chưa có sản phẩm một phân loại còn hàng');
    // Cờ ở máy chủ cũng tắt (ca trước có thể dừng giữa chừng lúc đang bật).
    await setServerGuestCheckout(request, false);
    mockShop(api, d!, false);
    await seedGuestCart(page, d!, 1);
    const seen: string[] = [];
    const record = (r: Request) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) seen.push(`${r.method()} ${u.pathname}${u.search}`);
    };
    page.on('request', record);
    const log: Record<string, string[]> = {};
    const dir = COMPARE_DIR ? `${COMPARE_DIR}/${COMPARE_LABEL}` : undefined;
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const [name, path] of [['cart', '/gio-hang'], ['checkout', '/thanh-toan']] as const) {
        seen.length = 0;
        await page.goto(path);
        if (name === 'cart') {
          const cta = visible(page, 'guest-cart-login');
          await expect(cta).toHaveText('Đăng nhập để đặt hàng', { timeout: 15_000 });
          await expect(cta).toHaveAttribute('href', '/dang-nhap?returnTo=%2Fgio-hang');
          await expect(page.getByTestId('cart-line').first()).toHaveAttribute('data-state', 'ok');
        } else {
          await expect(page.getByText('Đăng nhập để thanh toán đơn hàng.')).toBeVisible({ timeout: 15_000 });
          await expect(page.getByTestId('guest-checkout')).toHaveCount(0);
        }
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        log[`${name}-${size.width}`] = [...seen].sort();
        await shoot(page, dir, `${name}-${size.width}`);
      }
    }
    page.off('request', record);
    expect(Object.values(log).flat().filter((r) => r.includes('/checkout/guest'))).toEqual([]);
    if (dir) writeFileSync(`${dir}/requests.json`, JSON.stringify(log, null, 2));
  });
});
