import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { bankQrFor } from './support/bank-fixture';
import { captureVietQrImage, SHORT_BANK } from './support/pre-submit';

/**
 * tubu-w39-02: trang QR chuyển khoản web `/thanh-toan/chuyen-khoan/<mã>` có thẻ kết bạn Zalo Tubu Tree khi GET /payments/bank-qr/:code trả
 * `zaloFriendCard: true` (máy chủ đã xét cổng MSS, đồng ý ở đơn, tin bạn bè). Đơn chuyển khoản không qua màn đặt xong nên đây là chỗ duy nhất khách
 * thấy lời mời. Điện thoại: chỉ nút mở zalo.me, không có mã QR (không tải thư viện vẽ QR). Máy tính: thêm mã QR cùng liên kết để quét bằng điện thoại.
 * Đặt SHOT_DIR thì chụp 360×800 và 390×844 để đếm nút trên màn (luật chống nhồi nhét).
 */
const WEB_PROJECTS = new Set(['Web Customer', 'Web Customer Mobile']);
const AMOUNT = 149_000;
const ZALO_URL = 'https://zalo.me/0899149229';
const CHECK = 'Tôi đã chuyển khoản — Kiểm tra';

const card = (page: Page) => page.getByTestId('bank-zalo-friend').filter({ visible: true });

async function openBankPage(page: Page, api: Parameters<typeof mockWorld>[0], over: Parameters<typeof bankQrFor>[2]): Promise<void> {
  await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
  api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, AMOUNT, over));
  await captureVietQrImage(page);
  await page.goto(`/thanh-toan/chuyen-khoan/${SHORT_BANK}`);
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

async function shootViewport(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

test.describe('Trang chuyển khoản web: thẻ kết bạn Zalo (w39-02)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
  });

  test('điện thoại 375×812: thẻ dưới "Để sau / Xem đơn hàng", nút mở zalo.me, không có mã QR; nút Kiểm tra vẫn là nút chính', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ điện thoại');
    await page.setViewportSize({ width: 375, height: 812 });
    await openBankPage(page, api, { zaloFriendCard: true });
    await expect(card(page)).toBeVisible({ timeout: 20_000 });

    const cta = card(page).getByRole('link', { name: 'Mở Zalo Tubu Tree' });
    await expect(cta).toHaveAttribute('href', ZALO_URL);
    await expect(cta).toHaveAttribute('target', '_blank');
    await expect(card(page).getByText(`Nhận Bill & theo dõi đơn ${SHORT_BANK} miễn phí qua Zalo Tubu Tree`)).toBeVisible();
    await expect(page.getByTestId('order-zalo-friend-qr')).toBeHidden();
    await expect(page.locator('img[alt="QR Zalo Tubu Tree"]')).toHaveCount(0);

    const later = page.getByRole('link', { name: 'Để sau / Xem đơn hàng' }).filter({ visible: true });
    const laterBox = (await later.boundingBox())!;
    const cardBox = (await card(page).boundingBox())!;
    expect(cardBox.y).toBeGreaterThanOrEqual(laterBox.y + laterBox.height);
    // Chỉ một nút trong thẻ (ưu tiên thấp nhất), nút chính vẫn là Kiểm tra ở thanh dưới.
    expect(await card(page).locator('a, button').count()).toBe(1);
    await expect(page.getByRole('button', { name: CHECK }).filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(api.callsTo('GET', '/config/order-zalo')).toHaveLength(0);
  });

  test('máy tính 1280×800: thẻ có thêm mã QR cùng liên kết zalo.me', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'Khổ máy tính');
    await page.setViewportSize({ width: 1280, height: 800 });
    await openBankPage(page, api, { zaloFriendCard: true });
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    const qr = page.getByTestId('order-zalo-friend-qr');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('data-qr-value', ZALO_URL);
    await expect(qr.locator('img[alt="QR Zalo Tubu Tree"]')).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 15_000 });
    await expect(card(page).getByRole('link', { name: 'Mở Zalo Tubu Tree' })).toHaveAttribute('href', ZALO_URL);
  });

  test('máy chủ bảo ẩn hoặc API cũ không trả trường: không có thẻ', async ({ page, api }) => {
    for (const over of [{ zaloFriendCard: false }, {}]) {
      await openBankPage(page, api, over);
      await expect(page.getByText(CHECK).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: 'Để sau / Xem đơn hàng' }).filter({ visible: true })).toBeVisible();
      await expect(page.getByTestId('bank-zalo-friend')).toHaveCount(0);
    }
  });

  test('đã nhận tiền: thẻ vẫn ở dưới "Xem đơn hàng / Về trang chủ"', async ({ page, api }) => {
    await openBankPage(page, api, { zaloFriendCard: true, paymentStatus: 'PAID', paymentDeadline: null });
    await expect(page.getByText('Đã nhận thanh toán!').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toBeVisible();
    const homeBox = (await page.getByRole('link', { name: 'Về trang chủ' }).filter({ visible: true }).boundingBox())!;
    expect((await card(page).boundingBox())!.y).toBeGreaterThanOrEqual(homeBox.y + homeBox.height);
  });

  for (const size of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`ảnh ${size.width}×${size.height}: chờ chuyển và đã nhận tiền, không tràn ngang`, async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ điện thoại');
      await page.setViewportSize(size);
      await openBankPage(page, api, { zaloFriendCard: true });
      await expect(card(page)).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await shoot(page, `web-bank-zalo-${size.width}`);
      // Ảnh toàn trang của màn có thanh nút dính dưới chỉ thấy phần đầu: chụp thêm khung nhìn khi thẻ ở giữa màn để đếm nút quanh thẻ.
      await card(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shootViewport(page, `web-bank-zalo-card-${size.width}`);

      await openBankPage(page, api, { zaloFriendCard: true, paymentStatus: 'PAID', paymentDeadline: null });
      await expect(page.getByText('Đã nhận thanh toán!').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
      await expect(card(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await shoot(page, `web-bank-zalo-paid-${size.width}`);
    });
  }
});
