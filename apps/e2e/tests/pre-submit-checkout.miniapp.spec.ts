import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { CHECKOUT_ADDRESS, CHECKOUT_QUOTE } from './support/checkout-mocks';
import { axeInside, mockOrderZalo, ORDER_ZALO_RECIPIENT_STATUS } from './support/order-zalo-mocks';
import { BANK_FIXTURE } from './support/bank-fixture';
import { captureVietQrImage, expectEmvQr, expectQrImage, miniPath, mockBankQr, placeWithShortCodes, SHORT_BANK, SHORT_COD } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02), Mini App /checkout ở 375px: đặt COD và chuyển khoản tới màn đặt xong / màn QR, ô "Nhận hành trình đơn
 * hàng qua Zalo" tick sẵn theo `prechecked`, công tắc người nhận (PO A1) cùng luật với web. Chạy cả trên Vite dev (`playwright.config.ts`) lẫn bản
 * build `www` (`playwright.mini-www.config.ts`), nên mọi đường dẫn đi qua `miniPath`. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const PRECHECKED = { ...ORDER_ZALO_RECIPIENT_STATUS, prechecked: true };
const GIFT = { ...CHECKOUT_ADDRESS, id: 'addr-gift', recipient: 'Bà Ngoại', phone: '0912345678', isDefault: true };
const GIFT_2 = { ...CHECKOUT_ADDRESS, id: 'addr-gift-2', recipient: 'Trần Thị B', phone: '0987654321', isDefault: false };
const SELF = { ...CHECKOUT_ADDRESS, id: 'addr-self', recipient: 'Nguyễn Văn A', isDefault: false };

const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng · / });
const zaloBox = (page: Page) => page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
const recipientBlock = (page: Page) => page.getByTestId('order-zalo-recipient');
const recipientBox = (page: Page) => page.getByRole('checkbox', { name: /Gửi thêm thông báo giao hàng \(không kèm giá\) cho số người nhận/ });

async function pickAddress(page: Page, name: RegExp): Promise<void> {
  const row = page.getByTestId('checkout-address-row');
  await row.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Chọn địa chỉ giao hàng' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name }).click();
  await expect(row).toContainText(name);
}

test.describe('Trước gửi duyệt: thanh toán Mini App (COD, chuyển khoản, ô Zalo, người nhận)', () => {
  test('COD: ô Zalo tick sẵn theo prechecked, đặt gửi orderZaloConsent: true, màn đặt xong hiện mã ngắn và lời mời kết bạn', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    await page.goto(miniPath('/checkout'));
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toHaveAttribute('aria-checked', 'true');
    await expect(zaloBox(page)).toContainText('Số nhận: 090•••4567');
    await expect(recipientBlock(page)).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body).toMatchObject({ paymentMethod: 'COD', addressId: CHECKOUT_ADDRESS.id, orderZaloConsent: true });
    expect(body).not.toHaveProperty('notifyRecipientZalo');
    await expect(page.getByText(SHORT_COD).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Nhận Bill & theo dõi đơn ${SHORT_COD} miễn phí qua Zalo Tubu Tree`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('chuyển khoản: đặt gửi BANK_TRANSFER, sang màn QR mã ngắn với tài khoản fixture, ảnh QR đúng khuôn, chuỗi EMV đúng CRC, chép số tài khoản', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Project Mini chạy WebKit (iPhone 12): không cấp được quyền clipboard, giả writeText.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => { (window as unknown as { __copied?: string }).__copied = t; return Promise.resolve(); } },
      });
    });
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    mockBankQr(api, CHECKOUT_QUOTE.total);
    const images = await captureVietQrImage(page);
    await page.goto(miniPath('/checkout'));
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    const bankRadio = page.getByRole('radio', { name: 'Chuyển khoản ngân hàng' });
    await bankRadio.click();
    await expect(bankRadio).toHaveAttribute('aria-checked', 'true');

    const placed = api.waitForCall('POST', '/checkout/place-order');
    const qrResponse = page.waitForResponse((r) => r.url().includes(`/payments/bank-qr/${SHORT_BANK}`));
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ paymentMethod: 'BANK_TRANSFER', orderZaloConsent: true });
    await expect(page).toHaveURL(new RegExp(`/bank-payment/${SHORT_BANK}$`), { timeout: 15_000 });
    const qr = (await (await qrResponse).json()) as { qrString: string };
    expectEmvQr(qr.qrString, SHORT_BANK, CHECKOUT_QUOTE.total, BANK_FIXTURE);

    await expect(page.getByText('Quét QR để chuyển khoản')).toBeVisible({ timeout: 15_000 });
    for (const text of [BANK_FIXTURE.name, BANK_FIXTURE.accountNo, BANK_FIXTURE.accountName]) await expect(page.getByText(text).first()).toBeVisible();
    await expect(page.getByTestId('memo-note')).toContainText(SHORT_BANK);
    const img = page.locator('img[alt="VietQR"]');
    await expect(img).toBeVisible();
    expectQrImage(await img.getAttribute('src'), SHORT_BANK, CHECKOUT_QUOTE.total);
    await expect.poll(() => images.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Sao chép số tài khoản' }).click();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(BANK_FIXTURE.accountNo);
    await page.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }).click();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(SHORT_BANK);
    expect(errors).toEqual([]);
  });

  test('công tắc người nhận: chỉ khi ô tick và số nhận khác số tài khoản; mặc định tắt, tự tắt khi đổi địa chỉ hay bỏ tick; bật rồi đặt gửi notifyRecipientZalo', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT, GIFT_2, SELF]);
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    await page.goto(miniPath('/checkout'));
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });

    await expect(zaloBox(page)).toHaveAttribute('aria-checked', 'true');
    await expect(recipientBlock(page)).toContainText('Số nhận hàng khác số tài khoản. Tin xác nhận đơn luôn gửi về Zalo số 090•••4567.');
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'false');
    expect((await recipientBox(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await recipientBox(page).click();
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'true');

    await pickAddress(page, /Trần Thị B/);
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'false');

    await recipientBox(page).click();
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'true');
    await zaloBox(page).click();
    await expect(zaloBox(page)).toHaveAttribute('aria-checked', 'false');
    await expect(recipientBlock(page)).toHaveCount(0);
    await zaloBox(page).click();
    await expect(zaloBox(page)).toHaveAttribute('aria-checked', 'true');
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'false');

    await pickAddress(page, /Nguyễn Văn A/);
    await expect(recipientBlock(page)).toHaveCount(0);
    await pickAddress(page, /Bà Ngoại/);
    await expect(recipientBox(page)).toHaveAttribute('aria-checked', 'false');
    await recipientBox(page).click();
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ addressId: GIFT.id, orderZaloConsent: true, notifyRecipientZalo: true });
    await expect(page.getByText(SHORT_COD).first()).toBeVisible({ timeout: 15_000 });
  });

  test('cờ người nhận tắt (recipientEnabled false): đơn tặng không có công tắc, thân đơn không có notifyRecipientZalo', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT]);
    mockOrderZalo(api, true, { ...PRECHECKED, recipientEnabled: false });
    placeWithShortCodes(api);
    await page.goto(miniPath('/checkout'));
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toHaveAttribute('aria-checked', 'true');
    await expect(recipientBlock(page)).toHaveCount(0);
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body.orderZaloConsent).toBe(true);
    expect(body).not.toHaveProperty('notifyRecipientZalo');
  });

  test('axe: ô Zalo và công tắc người nhận không vi phạm serious/critical', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT]);
    mockOrderZalo(api, true, PRECHECKED);
    await page.goto(miniPath('/checkout'));
    await expect(recipientBlock(page)).toBeVisible({ timeout: 20_000 });
    expect(await axeInside(page, zaloBox(page))).toEqual([]);
    expect(await axeInside(page, recipientBlock(page))).toEqual([]);
  });
});
