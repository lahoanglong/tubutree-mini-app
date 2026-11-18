import { mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { BANK_QR, CHECKOUT_ADDRESS, CHECKOUT_CART, CHECKOUT_LOYALTY, CHECKOUT_QUOTE, CHECKOUT_WALLET, ORDER_CODE_BANK, mockCheckout, mockWebCheckoutExtras, placedOrderFor } from './support/checkout-mocks';
import { observeCls, readClsTotal } from './support/cls-observer';
import { probeTapTargets } from './support/touch-probe';

/**
 * Wave tubu-w2-06 (web, 390×844 ở "Web Customer Mobile" và 1440×900 ở "Web Customer"):
 * - địa chỉ một dòng, "Đổi" mở tấm chọn, đổi sang địa chỉ đã lưu khác trong 2 chạm; trong lúc tính lại tổng cũ giữ trên màn (không về "…"), nút Đặt hàng khoá;
 * - chọn Chuyển khoản (cờ checkout.transfer_preview_enabled bật) thấy thẻ ngân hàng/chủ tài khoản/số tiền và KHÔNG có QR trước khi có mã đơn; đặt xong thấy QR;
 * - CLS ≤ 0,05 ở /thanh-toan và trang chuyển khoản khi dữ liệu về trễ 800 ms (3 lần, trung vị, cùng cách nav-merge-web-fixes); /gio-hang chỉ đo, không chặn.
 * Đặt W206_SHOT_DIR để chụp ảnh.
 */
const SLOW_MS = 800;
const CLS_MAX = 0.05;
const RUNS = 3;
const later = <T>(value: T, ms = SLOW_MS) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const OTHER_ADDRESS = { ...CHECKOUT_ADDRESS, id: 'addr-office-2', recipient: 'Trần Thị B', phone: '0987654321', street: '45 Nguyễn Huệ, toà nhà văn phòng tầng 12', isDefault: false };
const QUOTE_OTHER = { ...CHECKOUT_QUOTE, shippingFee: 25000, total: CHECKOUT_QUOTE.subtotal + 25000 };
// Ảnh QR là PNG 1×1 hợp lệ: ảnh GIF cụt của BANK_QR báo lỗi tải nên trang hiện "Chưa tải được mã QR", không đo được lúc QR hiện.
const BANK_QR_PNG = { ...BANK_QR, qrImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
const PREVIEW_ON = { enabled: true, bank: { name: BANK_QR.bank.name, accountName: BANK_QR.bank.accountName } };

const viewportOf = (project: string) => (project === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
const runsHere = (project: string) => project === 'Web Customer' || project === 'Web Customer Mobile';
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.W206_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `web-${page.viewportSize()?.width}-${name}.png`) });
}

/** Khách đã đăng nhập với hai địa chỉ; báo giá theo địa chỉ, địa chỉ thứ hai về trễ để thấy trạng thái đang tính lại. */
async function mockTwoAddresses(api: MockApi, page: Page, { previewOn = false, otherQuoteMs = 1500 } = {}): Promise<void> {
  mockCheckout(api);
  mockWebCheckoutExtras(api);
  mockSession(api, makeUser({ id: 'user-checkout', fullName: 'Nguyễn Văn A', pointsBalance: 50, pointsConvertedBalance: 50, walletBalance: CHECKOUT_WALLET.walletBalance }));
  api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: CHECKOUT_WALLET.walletBalance });
  api.get('/me/addresses', [CHECKOUT_ADDRESS, OTHER_ADDRESS]);
  api.post('/checkout/quote', ({ call }) =>
    (call.body as { addressId?: string } | undefined)?.addressId === OTHER_ADDRESS.id ? later(QUOTE_OTHER, otherQuoteMs) : CHECKOUT_QUOTE,
  );
  api.get('/payments/bank-qr/:code', BANK_QR_PNG);
  if (previewOn) api.get('/payments/bank-preview', PREVIEW_ON);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: trang vẫn mở
    }
  });
}

const summaryTotal = (page: Page) => page.locator('[data-ds="checkout-summary-total"]').locator('span').last();
const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng/ }).last();

test.describe('w2-06 thanh toán web', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
    await page.setViewportSize(viewportOf(testInfo.project.name));
  });

  test('đổi địa chỉ đã lưu trong 2 chạm: tổng cũ giữ (không về "…"), nút khoá tới khi báo giá mới về', async ({ page, api }) => {
    await mockTwoAddresses(api, page);
    await page.goto('/thanh-toan');
    const row = page.getByTestId('checkout-address-row');
    await expect(row).toContainText('Nguyễn Văn A · 090****567');
    await expect(summaryTotal(page)).toHaveText(vnd(CHECKOUT_QUOTE.total));
    await shoot(page, 'address-row');

    let taps = 0;
    await row.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
    taps += 1;
    const sheet = page.getByRole('dialog', { name: 'Chọn địa chỉ giao hàng' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('radio')).toHaveCount(2);
    await expect(sheet.getByRole('radio').first()).toContainText('Mặc định');
    await expect(sheet.getByRole('button', { name: 'Thêm địa chỉ mới' })).toBeVisible();
    await shoot(page, 'address-sheet');
    await sheet.getByRole('radio', { name: /Trần Thị B/ }).click();
    taps += 1;
    expect(taps).toBe(2);
    await expect(sheet).toBeHidden();
    await expect(row).toContainText('Trần Thị B · 098****321');
    // Đang tính lại: số cũ vẫn trên màn, nút khoá.
    await expect(summaryTotal(page)).toHaveText(vnd(CHECKOUT_QUOTE.total));
    await expect(placeButton(page)).toBeDisabled();
    await shoot(page, 'address-recalculating');
    await expect(summaryTotal(page)).toHaveText(vnd(QUOTE_OTHER.total), { timeout: 5_000 });
    await expect(placeButton(page)).toBeEnabled();
  });

  test('vùng chạm ≥ 44px ở dòng địa chỉ và tấm chọn; 360px không tràn ngang', async ({ page, api }, testInfo) => {
    await mockTwoAddresses(api, page);
    if (testInfo.project.name === 'Web Customer Mobile') await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/thanh-toan');
    await expect(page.getByTestId('checkout-address-row')).toBeVisible();
    expect(await probeTapTargets(page, { scope: '[data-testid="checkout-address-block"]' })).toEqual([]);
    await page.getByTestId('checkout-address-row').getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Đo khi tấm đã trượt xong: giữa chừng toạ độ lẻ làm vùng chạm đo hụt 1px.
    await expect.poll(() => page.getByRole('dialog').evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);
    expect(await probeTapTargets(page, { scope: '[role="dialog"]' })).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('cờ bật: chọn Chuyển khoản thấy thẻ xem trước, không có QR trước khi có mã đơn; đặt xong thấy QR', async ({ page, api }) => {
    await mockTwoAddresses(api, page, { previewOn: true });
    await page.goto('/thanh-toan');
    await expect(summaryTotal(page)).toHaveText(vnd(CHECKOUT_QUOTE.total));
    await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).check();
    const card = page.getByTestId('transfer-preview');
    await expect(card).toBeVisible();
    await expect(card).toContainText(BANK_QR.bank.name);
    await expect(card).toContainText(BANK_QR.bank.accountName);
    await expect(card).toContainText(vnd(CHECKOUT_QUOTE.total));
    await expect(card).toContainText('Mã QR có đúng số tiền và nội dung sẽ hiện ngay sau khi bạn bấm Đặt hàng.');
    await expect(card).not.toContainText(BANK_QR.bank.accountNo);
    await expect(page.locator('img[alt="VietQR"], canvas, [data-testid*="qr" i]')).toHaveCount(0);
    await shoot(page, 'transfer-preview');

    const placed = page.waitForResponse((r) => r.url().includes('/checkout/place-order'));
    await placeButton(page).click();
    await placed;
    const t0 = Date.now();
    await expect(page).toHaveURL(new RegExp(`/thanh-toan/chuyen-khoan/${ORDER_CODE_BANK}`));
    const qr = page.locator('img[alt="VietQR"]');
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const msToQr = Date.now() - t0;
    test.info().annotations.push({ type: 'W206_QR_MS', description: String(msToQr) });
    console.log(`W206_QR_MS web ${page.viewportSize()?.width} ${msToQr}`);
    expect(msToQr, 'thời gian từ lúc có đơn tới QR').toBeLessThanOrEqual(1_000);
    // Trang QR đọc đúng lời gọi đã bắt đầu từ trang thanh toán: không gọi QR hai lần cho một mã.
    expect(api.callsTo('GET', '/payments/bank-qr/:code').length).toBe(1);
    await shoot(page, 'transfer-qr');
  });

  test('cờ tắt: chọn Chuyển khoản không có thẻ xem trước (như trước wave)', async ({ page, api }) => {
    await mockTwoAddresses(api, page);
    await page.goto('/thanh-toan');
    await expect(summaryTotal(page)).toHaveText(vnd(CHECKOUT_QUOTE.total));
    await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).check();
    await expect(page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ })).toBeChecked();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('transfer-preview')).toHaveCount(0);
    await shoot(page, 'transfer-flag-off');
  });
});

/** Một lần tải như nav-merge-web-fixes: bộ nhớ trình duyệt đã xoá (init script), chờ trạng thái cuối, đọc tổng layout-shift. */
async function loadOnce(page: Page, url: string, ready: () => Promise<void>): Promise<{ cls: number; sources: string[] }> {
  await page.goto(url);
  await ready();
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(800);
  return readClsTotal(page);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Như PROD: mọi dữ liệu của khách về sau 800 ms để khung chờ vẽ xong rồi mới bị thay. */
function mockSlowCheckout(api: MockApi): void {
  mockCheckout(api);
  mockWebCheckoutExtras(api);
  const user = makeUser({ id: 'user-checkout', fullName: 'Nguyễn Văn A', pointsBalance: 50, pointsConvertedBalance: 50, walletBalance: CHECKOUT_WALLET.walletBalance });
  mockSession(api, user);
  api.get('/me', () => later({ id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: CHECKOUT_WALLET.walletBalance }));
  api.get('/cart', () => later(CHECKOUT_CART));
  api.get('/me/addresses', () => later([CHECKOUT_ADDRESS]));
  api.get('/me/loyalty', () => later(CHECKOUT_LOYALTY));
  api.get('/me/wallet', () => later(CHECKOUT_WALLET));
  api.post('/checkout/quote', () => later(CHECKOUT_QUOTE));
  api.post('/checkout/place-order', ({ call }) => placedOrderFor((call.body ?? {}) as Record<string, unknown>));
  api.get('/payments/bank-qr/:code', () => later(BANK_QR_PNG));
}

const CLS_PAGES = [
  { name: '/thanh-toan', url: '/thanh-toan', ready: (page: Page) => expect(summaryTotal(page)).toHaveText(vnd(CHECKOUT_QUOTE.total), { timeout: 20_000 }), gate: true },
  { name: 'chuyển khoản', url: `/thanh-toan/chuyen-khoan/${ORDER_CODE_BANK}`, ready: (page: Page) => expect(page.locator('img[alt="VietQR"]')).toBeVisible({ timeout: 20_000 }), gate: true },
  // Giỏ thuộc wave khác: chỉ đo để báo số, không chặn.
  { name: '/gio-hang', url: '/gio-hang', ready: (page: Page) => expect(page.getByText(CHECKOUT_CART.items[0]!.productName).first()).toBeVisible({ timeout: 20_000 }), gate: false },
];

for (const p of CLS_PAGES) {
  test(`CLS ${p.name}: đăng nhập, dữ liệu về trễ ${SLOW_MS} ms, trung vị ${RUNS} lần${p.gate ? ` ≤ ${CLS_MAX}` : ' (chỉ đo)'}`, async ({ page, api }, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
    const vp = viewportOf(testInfo.project.name);
    await page.setViewportSize(vp);
    await observeCls(page);
    mockSlowCheckout(api);
    // Mỗi lần tải như khách mới trên máy (bộ nhớ trống), vẫn còn phiên đăng nhập.
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage
      }
    });
    const runs: { cls: number; sources: string[] }[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await loadOnce(page, p.url, () => p.ready(page)));
    const values = runs.map((r) => r.cls);
    const mid = median(values);
    const line = `W206_CLS ${p.name} ${vp.width}x${vp.height} median=${mid.toFixed(4)} runs=[${values.map((v) => v.toFixed(4)).join(', ')}]`;
    console.log(line);
    testInfo.annotations.push({ type: 'CLS', description: line });
    if (p.gate) expect(mid, `${line} ${runs.flatMap((r) => r.sources).join(' ; ')}`).toBeLessThanOrEqual(CLS_MAX);
  });
}
