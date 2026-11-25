import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { CHECKOUT_ADDRESS, CHECKOUT_QUOTE } from './support/checkout-mocks';
import { axeInside, mockOrderZalo, ORDER_ZALO_RECIPIENT_STATUS } from './support/order-zalo-mocks';
import { BANK_FIXTURE } from './support/bank-fixture';
import { captureVietQrImage, expectEmvQr, expectQrImage, mockBankQr, placeWithShortCodes, SHORT_BANK, SHORT_COD } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02), web /thanh-toan của khách đăng nhập: đặt COD và chuyển khoản tới tận màn đặt xong / trang QR, ô
 * "Nhận hành trình đơn hàng qua Zalo" tick sẵn theo `prechecked` của máy chủ (PROD bật `orderZaloPrechecked`), công tắc người nhận (PO A1) chỉ hiện
 * khi ô đang tick, số nhận khác số tài khoản và cờ người nhận bật; mặc định tắt, tự tắt khi đổi địa chỉ hay bỏ tick. Mọi lời gọi /api/** đi qua mock.
 */
const WEB_PROJECTS = new Set(['Web Customer', 'Web Customer Mobile']);
const PRECHECKED = { ...ORDER_ZALO_RECIPIENT_STATUS, prechecked: true };
const GIFT = { ...CHECKOUT_ADDRESS, id: 'addr-gift', recipient: 'Bà Ngoại', phone: '0912345678', isDefault: true };
const GIFT_2 = { ...CHECKOUT_ADDRESS, id: 'addr-gift-2', recipient: 'Trần Thị B', phone: '0987654321', isDefault: false };
const SELF = { ...CHECKOUT_ADDRESS, id: 'addr-self', recipient: 'Nguyễn Văn A', isDefault: false };

const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng · / }).filter({ visible: true });
const zaloBox = (page: Page) => page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
const zaloRow = (page: Page) => page.locator('label').filter({ has: zaloBox(page) });
const recipientBlock = (page: Page) => page.getByTestId('order-zalo-recipient');
const recipientBox = (page: Page) => page.getByRole('checkbox', { name: /Gửi thêm thông báo giao hàng \(không kèm giá\) cho số người nhận/ });
const recipientRow = (page: Page) => page.locator('label').filter({ has: recipientBox(page) });

async function pickAddress(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId('checkout-address-row').getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Chọn địa chỉ giao hàng' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('checkout-address-row')).toContainText(name);
}

test.describe('Trước gửi duyệt: thanh toán web (COD, chuyển khoản, ô Zalo, người nhận)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
    await page.setViewportSize(testInfo.project.name === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  test('COD: ô Zalo tick sẵn theo prechecked, đặt gửi orderZaloConsent: true, màn đặt xong hiện mã ngắn', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toBeChecked();
    await expect(zaloRow(page)).toContainText('Số nhận: 090•••4567');
    await expect(recipientBlock(page)).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body).toMatchObject({ paymentMethod: 'COD', addressId: CHECKOUT_ADDRESS.id, orderZaloConsent: true });
    expect(body).not.toHaveProperty('notifyRecipientZalo');
    await expect(page.getByText(SHORT_COD).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Nhận Bill & theo dõi đơn ${SHORT_COD} miễn phí qua Zalo Tubu Tree`).filter({ visible: true })).toBeVisible();
  });

  test('chuyển khoản: đặt gửi BANK_TRANSFER + ô Zalo, sang trang QR mã ngắn với tài khoản fixture, ảnh QR đúng khuôn, chuỗi EMV đúng CRC', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    mockBankQr(api, CHECKOUT_QUOTE.total);
    const images = await captureVietQrImage(page);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await page.getByLabel('Chuyển khoản ngân hàng').check();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    const qrResponse = page.waitForResponse((r) => r.url().includes(`/payments/bank-qr/${SHORT_BANK}`));
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ paymentMethod: 'BANK_TRANSFER', orderZaloConsent: true });
    await expect(page).toHaveURL(new RegExp(`/thanh-toan/chuyen-khoan/${SHORT_BANK}$`), { timeout: 15_000 });
    const qr = (await (await qrResponse).json()) as { qrString: string };
    expectEmvQr(qr.qrString, SHORT_BANK, CHECKOUT_QUOTE.total, BANK_FIXTURE);

    await expect(page.getByText(BANK_FIXTURE.accountNo).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(BANK_FIXTURE.accountName).filter({ visible: true }).first()).toBeVisible();
    const img = page.locator('img[alt="VietQR"]').filter({ visible: true });
    await expect(img).toBeVisible();
    expectQrImage(await img.getAttribute('src'), SHORT_BANK, CHECKOUT_QUOTE.total);
    await expect.poll(() => images.length).toBeGreaterThan(0);
    expectQrImage(images[0], SHORT_BANK, CHECKOUT_QUOTE.total);
    await expect(page.getByTestId('bank-qr-failed')).toHaveCount(0);
  });

  test('công tắc người nhận: chỉ khi ô tick và số nhận khác số tài khoản; mặc định tắt, tự tắt khi đổi địa chỉ hay bỏ tick; bật rồi đặt gửi notifyRecipientZalo', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT, GIFT_2, SELF]);
    mockOrderZalo(api, true, PRECHECKED);
    placeWithShortCodes(api);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });

    await expect(zaloBox(page)).toBeChecked();
    await expect(recipientBlock(page)).toContainText('Số nhận hàng khác số tài khoản. Tin xác nhận đơn luôn gửi về Zalo số 090•••4567.');
    await expect(recipientBox(page)).not.toBeChecked();
    await recipientRow(page).click();
    await expect(recipientBox(page)).toBeChecked();

    await pickAddress(page, /Trần Thị B/);
    await expect(recipientBox(page)).toBeVisible();
    await expect(recipientBox(page)).not.toBeChecked();

    await recipientRow(page).click();
    await expect(recipientBox(page)).toBeChecked();
    await zaloRow(page).click();
    await expect(zaloBox(page)).not.toBeChecked();
    await expect(recipientBlock(page)).toHaveCount(0);
    await zaloRow(page).click();
    await expect(zaloBox(page)).toBeChecked();
    await expect(recipientBox(page)).not.toBeChecked();

    await pickAddress(page, /Nguyễn Văn A/);
    await expect(recipientBlock(page)).toHaveCount(0);
    await pickAddress(page, /Bà Ngoại/);
    await expect(recipientBox(page)).not.toBeChecked();
    await recipientRow(page).click();
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ addressId: GIFT.id, orderZaloConsent: true, notifyRecipientZalo: true });
    await expect(page.getByText(SHORT_COD).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('cờ người nhận tắt (recipientEnabled false): đơn tặng không có công tắc, thân đơn không có notifyRecipientZalo', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT]);
    mockOrderZalo(api, true, { ...PRECHECKED, recipientEnabled: false });
    placeWithShortCodes(api);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toBeChecked();
    await expect(recipientBlock(page)).toHaveCount(0);
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body.orderZaloConsent).toBe(true);
    expect(body).not.toHaveProperty('notifyRecipientZalo');
  });

  test('axe: ô Zalo và công tắc người nhận không vi phạm serious/critical', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    api.get('/me/addresses', [GIFT]);
    mockOrderZalo(api, true, PRECHECKED);
    await page.goto('/thanh-toan');
    await expect(recipientBlock(page)).toBeVisible({ timeout: 20_000 });
    expect(await axeInside(page, zaloRow(page))).toEqual([]);
    expect(await axeInside(page, recipientBlock(page))).toEqual([]);
  });
});
