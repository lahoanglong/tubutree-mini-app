import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { bankQrFor } from './support/bank-fixture';
import { captureVietQrImage, miniPath, SHORT_BANK } from './support/pre-submit';
import { eventsNamed, flushEvents } from './support/events';

/**
 * tubu-w39-02: màn QR chuyển khoản Mini App `/bank-payment/<mã>` có thẻ kết bạn Zalo Tubu Tree khi GET /payments/bank-qr/:code trả
 * `zaloFriendCard: true`. Thẻ tải lười (entry Mini không đổi), nằm dưới "Để sau / Xem đơn hàng" lúc chờ chuyển và dưới "Về trang chủ" lúc đã nhận tiền;
 * không có mã QR (Mini mở zalo.me bằng openWebview). Đặt SHOT_DIR thì chụp 360×800 và 390×844.
 */
test.use({ viewport: { width: 375, height: 812 } });

const AMOUNT = 149_000;
const CHECK = 'Tôi đã chuyển khoản — Kiểm tra';

const card = (page: Page) => page.getByTestId('bank-zalo-friend');

async function openBankPage(page: Page, api: Parameters<typeof mockCheckout>[0], over: Parameters<typeof bankQrFor>[2]): Promise<void> {
  mockCheckout(api);
  api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, AMOUNT, over));
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /flash-sales/upcoming');
  await captureVietQrImage(page);
  await page.goto(miniPath(`/bank-payment/${SHORT_BANK}`));
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

test.describe('Màn chuyển khoản Mini App: thẻ kết bạn Zalo (w39-02)', () => {
  test('375×812: thẻ dưới "Để sau / Xem đơn hàng", một nút mở Zalo, không mã QR; bấm ghi sự kiện nơi bấm bank_transfer', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openBankPage(page, api, { zaloFriendCard: true });
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toContainText(`Nhận Bill & theo dõi đơn ${SHORT_BANK} miễn phí qua Zalo Tubu Tree`);
    const cta = card(page).getByRole('button', { name: 'Mở Zalo Tubu Tree' });
    await expect(cta).toBeVisible();
    expect(await card(page).locator('a, button').count()).toBe(1);
    expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('order-zalo-friend-qr')).toHaveCount(0);

    const laterBox = (await page.getByRole('button', { name: 'Để sau / Xem đơn hàng' }).boundingBox())!;
    expect((await card(page).boundingBox())!.y).toBeGreaterThanOrEqual(laterBox.y + laterBox.height);
    await expect(page.getByRole('button', { name: CHECK })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await cta.click();
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'order_zalo_friend_click').map((e) => e.props), { timeout: 15_000 }).toEqual([{ from: 'bank_transfer' }]);
    expect(errors).toEqual([]);
  });

  test('máy chủ bảo ẩn hoặc API cũ không trả trường: không có thẻ', async ({ page, api }) => {
    for (const over of [{ zaloFriendCard: false }, {}]) {
      await openBankPage(page, api, over);
      await expect(page.getByRole('button', { name: 'Để sau / Xem đơn hàng' })).toBeVisible({ timeout: 20_000 });
      await expect(card(page)).toHaveCount(0);
    }
  });

  test('chunk thẻ lỗi tải (mạng chập, bản mới thay chunk): mã QR và nút vẫn còn, không có thẻ, không lỗi trang', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let aborted = 0;
    await page.route(
      (u) => /\/order-zalo\.[^/]*$/.test(u.pathname),
      (route) => {
        aborted++;
        return route.abort('failed');
      },
    );
    await openBankPage(page, api, { zaloFriendCard: true });
    await expect.poll(() => aborted, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(page.locator('img[alt="VietQR"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Để sau / Xem đơn hàng' })).toBeVisible();
    await expect(page.getByRole('button', { name: CHECK })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('đã nhận tiền: thẻ vẫn ở dưới "Về trang chủ"', async ({ page, api }) => {
    await openBankPage(page, api, { zaloFriendCard: true, paymentStatus: 'PAID', paymentDeadline: null });
    await expect(page.getByText('Đã nhận thanh toán!')).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toBeVisible();
    const homeBox = (await page.getByRole('button', { name: 'Về trang chủ' }).boundingBox())!;
    expect((await card(page).boundingBox())!.y).toBeGreaterThanOrEqual(homeBox.y + homeBox.height);
  });

  for (const size of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`ảnh ${size.width}×${size.height}: chờ chuyển và đã nhận tiền, không tràn ngang`, async ({ page, api }) => {
      await page.setViewportSize(size);
      await openBankPage(page, api, { zaloFriendCard: true });
      await expect(card(page)).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      await shoot(page, `mini-bank-zalo-${size.width}`);
      // Ảnh toàn trang của màn có thanh nút dính dưới chỉ thấy phần đầu: chụp thêm khung nhìn khi thẻ ở giữa màn để đếm nút quanh thẻ.
      await card(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shootViewport(page, `mini-bank-zalo-card-${size.width}`);

      await openBankPage(page, api, { zaloFriendCard: true, paymentStatus: 'PAID', paymentDeadline: null });
      await expect(page.getByText('Đã nhận thanh toán!')).toBeVisible({ timeout: 20_000 });
      await expect(card(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      await shoot(page, `mini-bank-zalo-paid-${size.width}`);
    });
  }
});
