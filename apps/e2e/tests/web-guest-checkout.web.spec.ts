import type { APIRequestContext, Page, Request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, publicConfig, reply, type MockApi } from './support/mock-api';
import { serverGuestCheckoutReady, setServerGuestCheckout } from './support/guest-checkout-flag';
import { assertProductOnCi, singleVariationProduct } from './support/pdp-product';
import { probeW182 } from './support/w182-probe';

/**
 * Đặt hàng trên web không đăng nhập (cờ `web.guest_checkout_enabled`). Cờ bật: khách đi trang sản phẩm → Mua ngay → giỏ → Đặt hàng → một biểu mẫu
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

function config(flagOn: boolean) {
  return {
    ...publicConfig(),
    freeshipThreshold: 199000,
    webGuestCartEnabled: true,
    ...(flagOn ? { webGuestCheckoutEnabled: true, newCustomer: { welcomeVoucher: { amount: 30000 } } } : {}),
  };
}

function mockShop(api: MockApi, d: Detail, flagOn: boolean): void {
  api.get('/config/public', config(flagOn));
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

/** Đơn đã đặt ghi khoá theo dõi gửi lên; GET theo dõi chỉ trả đơn khi header `x-order-key` đúng khoá đó, sai thì cùng 404 như mã không có. */
function mockGuestOrders(api: MockApi, d: Detail, opts: QuoteOpts = {}): { key: () => string | null } {
  let key: string | null = null;
  let method: 'COD' | 'BANK_TRANSFER' = 'COD';
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
  api.get('/checkout/guest/orders/:code', ({ call, params }) => {
    if (params.code !== CODE || !key || call.headers['x-order-key'] !== key) return notFound;
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
    };
  });
  api.get('/checkout/guest/orders/:code/bank-qr', ({ call, params }) => {
    if (params.code !== CODE || !key || call.headers['x-order-key'] !== key) return notFound;
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

  test('trang sản phẩm → Mua ngay → giỏ → Đặt hàng → một biểu mẫu → đơn COD → trang theo dõi, đúng 9 chạm', async ({ page, api, request }, testInfo) => {
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
    await tap.click(buy);
    await page.waitForURL('**/gio-hang', { timeout: 15_000 });
    const cta = visible(page, 'guest-cart-login');
    await expect(cta).toHaveText('Đặt hàng');
    await expect(cta).toHaveAttribute('href', '/thanh-toan');
    await tap.click(cta);
    await page.waitForURL('**/thanh-toan', { timeout: 15_000 });
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
    expect(tap.count, 'số chạm từ trang sản phẩm tới lúc đặt xong').toBe(9);

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
