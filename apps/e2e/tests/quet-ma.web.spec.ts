import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { seedSession } from './support/a11y-buyer';
import { mockExternalPoints } from './support/external-points-mocks';
import { mockNoSession } from './support/flash-slot-mocks';

/**
 * Web `/quet-ma` quét và tích điểm đơn sàn ngay trên web (W44 U5): khách chưa đăng nhập thấy một nút chính "Đăng nhập để tích điểm" quay lại
 * đúng trang (giữ utm_source, card); khách đã đăng nhập thấy khung quét camera ngay đầu thẻ (W46, camera trước) với nút "Bật camera quét ngay"
 * giữa khung và hai lối phụ "Chụp / chọn ảnh", "Nhập mã thủ công"; kết quả, nút mua sắm theo điểm đang có và "Lịch sử tích điểm đơn sàn";
 * tài khoản chưa có SĐT nhập số ngay trên màn quét (W45). Đơn có SĐT người nhận khác SĐT tài khoản: hộp "Xác nhận SĐT nhận hàng" hỏi 4 số cuối
 * (W46). Máy giống iPhone (không có BarcodeDetector): ảnh mã vạch đọc bằng bộ đọc JS nạp lười rồi tự gửi. Vòng camera trực tiếp kiểm ở spec
 * thành phần. Đặt QUET_MA_SHOTS_DIR để chụp ảnh 360px và 375px.
 */
const SHOTS = process.env.QUET_MA_SHOTS_DIR;
const WIDTHS = [360, 375] as const;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'màn quét là màn điện thoại, chỉ chạy ở một project');
});

function quietShell(api: MockApi): void {
  // Lời gọi phụ của khung trang (đếm giỏ, gợi ý, sự kiện) không phải đối tượng của spec này.
  api.allowUnmocked('GET /:a', 'GET /:a/:b', 'GET /:a/:b/:c', 'POST /events/:a', 'POST /events/:a/:b');
}

async function loggedIn(page: Page, api: MockApi, phone: string | null, phoneVerified = phone !== null): Promise<void> {
  const user = mockSession(api, makeUser({ id: 'u-quet-ma', fullName: 'Nguyễn Văn An', phone: phone ?? undefined }));
  let me = { id: user.id, fullName: user.fullName, email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], phone, phoneVerified };
  api.get('/me', () => me);
  api.patch('/me/contact-phone', ({ call }) => {
    me = { ...me, phone: (call.body as { phone: string }).phone, phoneVerified: false };
    return me;
  });
  api.get('/me/loyalty', { pointsBalance: 1000, pointsMarketplaceBalance: 200, lockedPoints: 0 });
  await seedSession(page);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test.describe('Web /quet-ma: tích điểm đơn sàn trên web (W44)', () => {
  for (const width of WIDTHS) {
    test(`${width}px khách chưa đăng nhập: một nút chính đăng nhập quay lại /quet-ma giữ utm_source và card, lối phụ mở Mini App`, async ({ page, api }) => {
      mockNoSession(api);
      mockExternalPoints(api);
      quietShell(api);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/quet-ma?utm_source=shopee&card=2611&fbclid=x');
      const login = page.getByRole('link', { name: 'Đăng nhập để tích điểm' });
      await expect(login).toBeVisible({ timeout: 20_000 });
      const href = new URL((await login.getAttribute('href'))!, 'http://x');
      expect(href.pathname).toBe('/dang-nhap');
      const back = new URL(href.searchParams.get('returnTo')!, 'http://x');
      expect(back.pathname).toBe('/quet-ma');
      expect(Object.fromEntries(back.searchParams)).toEqual({ utm_source: 'shopee', card: '2611' });
      await expect(page.getByRole('link', { name: 'Hoặc quét trong Tubu Tree trên Zalo' })).toBeVisible();
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot(page, `web${width}-quet-ma-guest`);
    });

    test(`${width}px đã đăng nhập: khung quét camera trước, mở "Nhập mã thủ công", gửi, thấy kết quả, nút "Dùng 1.200 Điểm Xanh đang có"`, async ({ page, api }) => {
      await loggedIn(page, api, '0901234567');
      mockExternalPoints(api, {
        submit: {
          status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
          expectedCreditAt: new Date(Date.now() + 7 * 864e5).toISOString(), message: 'ok',
        },
      });
      quietShell(api);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/quet-ma');
      const scanner = page.getByTestId('claim-scanner');
      const start = scanner.getByRole('button', { name: 'Bật camera quét ngay' });
      await expect(start).toBeVisible({ timeout: 20_000 });
      await expect(scanner).toContainText('Đưa mã vạch/QR trên phiếu giao hàng vào khung');
      await expect(page.getByTestId('claim-photo-scan')).toHaveText('Chụp / chọn ảnh');
      const manual = page.getByTestId('claim-manual-toggle');
      await expect(manual).toHaveText('Nhập mã thủ công');
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Lịch sử tích điểm đơn sàn' })).toBeVisible();
      // Camera trước: khung quét nằm trọn trong màn đầu, trên hai viên thuốc.
      const frame = (await scanner.locator('.tubu-scanner__frame').boundingBox())!;
      expect(frame.y + frame.height).toBeLessThanOrEqual(800);
      expect(Math.round(frame.height)).toBe(Math.round((frame.width * 3) / 4));
      await noHorizontalScroll(page);
      await shot(page, `web${width}-quet-ma-authed`);
      await manual.click();
      const input = page.getByLabel('Hoặc nhập mã vận đơn');
      await expect(input).toBeVisible();
      await input.fill('SPXVN0123456789');
      await page.getByRole('button', { name: 'Tích điểm', exact: true }).click();
      const result = page.getByTestId('claim-result');
      await expect(result).toContainText('Đã ghi nhận đơn Shopee SPX***789');
      await expect(result).toContainText('1.250 Điểm Xanh đang chờ cộng');
      await expect(page.getByTestId('scan-shop-now').getByRole('button')).toHaveText('Dùng 1.200 Điểm Xanh đang có');
      expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([{ code: 'SPXVN0123456789', via: 'typed' }]);
      await noHorizontalScroll(page);
      await shot(page, `web${width}-quet-ma-result`);
    });
  }

  test('375px tài khoản chưa có SĐT (W45): nhập số ngay trên màn quét, lưu xong hiện khung quét kèm ghi chú CSKH đối chiếu', async ({ page, api }) => {
    await loggedIn(page, api, null);
    mockExternalPoints(api);
    quietShell(api);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quet-ma');
    const prompt = page.getByTestId('scan-phone-prompt');
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt.getByText('Thêm số điện thoại để tích điểm')).toBeVisible();
    await expect(prompt.getByRole('link', { name: 'Hoặc xác minh số trên Zalo để cộng điểm tự động' })).toHaveAttribute('href', /zalo\.me\/s\/\d+\/points\/scan/);
    await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, 'web375-quet-ma-no-phone');
    await prompt.getByLabel('Số điện thoại đặt hàng').fill('0912 345 678');
    await prompt.getByRole('button', { name: 'Lưu số và tích điểm' }).click();
    await expect(page.getByTestId('claim-scanner')).toBeVisible();
    await expect(page.getByTestId('claim-unverified-note')).toContainText('CSKH đối chiếu');
    expect(api.callsTo('PATCH', '/me/contact-phone').map((c) => c.body)).toEqual([{ phone: '0912345678' }]);
    await shot(page, 'web375-quet-ma-phone-saved');
  });
});

/** Ảnh PNG mã vạch Code 128 (bộ B) của `text`, vẽ bằng canvas trong trang: giống ảnh khách chụp nhãn SPX/J&T. */
async function code128Png(page: Page, text: string): Promise<Buffer> {
  const zxing = createRequire(resolve(__dirname, '../../web/package.json'))('@zxing/library') as { Code128Reader: { CODE_PATTERNS: Int32Array[] } };
  const values = [104, ...Array.from(text, (ch) => ch.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * Math.max(i, 1), 0) % 103;
  const widths = [...values, check, 106].flatMap((v) => Array.from(zxing.Code128Reader.CODE_PATTERNS[v]!));
  const dataUrl = await page.evaluate((ws) => {
    const px = 4;
    const total = ws.reduce((a, b) => a + b, 0);
    const canvas = document.createElement('canvas');
    canvas.width = (total + 40) * px;
    canvas.height = 260;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    let x = 20 * px;
    ws.forEach((w, i) => {
      if (i % 2 === 0) ctx.fillRect(x, 30, w * px, 200);
      x += w * px;
    });
    return canvas.toDataURL('image/png');
  }, widths);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

test.describe('Web /quet-ma trên iPhone: Safari, Zalo, Facebook không có BarcodeDetector (W45)', () => {
  test('375px: có nút "Bật camera quét ngay" và lối "Chụp / chọn ảnh"; chọn ảnh mã vạch thì bộ đọc JS (nạp lười) đọc rồi tự gửi via=scan, 0 lỗi', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
      delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    });
    await loggedIn(page, api, '0901234567', false);
    mockExternalPoints(api, {
      submit: { status: 'REVIEW', claimId: 'c2', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250, expectedCreditAt: null, message: 'ok' },
    });
    quietShell(api);
    // Chunk bộ đọc JS nhận ra qua tên lỗi riêng của ZXing (chỉ có trong chunk đó, tên tệp là mã băm).
    let zxingLoads = 0;
    page.on('response', async (res) => {
      if (res.request().resourceType() !== 'script') return;
      if ((await res.text().catch(() => '')).includes('ChecksumException')) zxingLoads++;
    });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quet-ma');
    const scanBtn = page.getByRole('button', { name: 'Bật camera quét ngay' });
    await expect(scanBtn).toBeVisible({ timeout: 20_000 });
    const photoBtn = page.getByTestId('claim-photo-scan');
    await expect(photoBtn).toHaveText('Chụp / chọn ảnh');
    await expect(photoBtn).toBeVisible();
    expect(await page.evaluate(() => 'BarcodeDetector' in window)).toBe(false);
    const picker = page.getByTestId('claim-photo-input');
    await expect(picker).toHaveAttribute('accept', 'image/*');
    await expect(picker).toHaveAttribute('capture', 'environment');
    await expect(page.getByTestId('claim-unverified-note')).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, 'web375-quet-ma-ios');

    await page.waitForLoadState('networkidle');
    expect(zxingLoads).toBe(0);
    const chooser = page.waitForEvent('filechooser');
    await photoBtn.click();
    await (await chooser).setFiles({ name: 'nhan-spx.png', mimeType: 'image/png', buffer: await code128Png(page, 'SPXVN0123456789') });
    await expect(page.getByTestId('claim-result')).toContainText('Tubu đang kiểm tra đơn này', { timeout: 15_000 });
    // Bộ đọc JS là chunk riêng: không tải lúc mở trang, tải đúng một lần sau khi khách chọn ảnh.
    await expect.poll(() => zxingLoads).toBe(1);
    expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([{ code: 'SPXVN0123456789', via: 'scan' }]);
    await shot(page, 'web375-quet-ma-ios-photo-read');
    expect(errors).toEqual([]);
  });
});

test.describe('Web /quet-ma: xác nhận 4 số cuối SĐT người nhận (W46)', () => {
  const CLAIMED_SHOPEE = {
    status: 'CLAIMED' as const, claimId: 'c3', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
    expectedCreditAt: new Date(Date.now() + 7 * 864e5).toISOString(), message: 'ok',
  };
  const required = (channel: string) => ({
    rejectCode: 'PHONE_CONFIRM_REQUIRED', status: 403, message: 'Cần xác nhận 4 số cuối SĐT người nhận trên đơn sàn để tích điểm đơn này.',
    extra: { channel, requiredDigits: 4 },
  });

  for (const width of WIDTHS) {
    test(`${width}px Shopee: SĐT lệch thì hộp hỏi 4 số cuối, nhập 8326 thì tích điểm, không lộ số nào của SĐT trên đơn`, async ({ page, api }) => {
      await loggedIn(page, api, '0901234567');
      mockExternalPoints(api, { submit: [required('shopee'), CLAIMED_SHOPEE] });
      quietShell(api);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/quet-ma');
      await page.getByTestId('claim-manual-toggle').click({ timeout: 20_000 });
      await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
      await page.getByRole('button', { name: 'Tích điểm', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: 'Xác nhận SĐT nhận hàng' });
      await expect(dialog).toBeVisible();
      const field = dialog.getByLabel('Nhập 4 số cuối SĐT nhận hàng trên đơn Shopee');
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute('inputmode', 'numeric');
      await expect(field).toHaveAttribute('pattern', '[0-9]*');
      await expect(field).toHaveAttribute('maxlength', '4');
      await expect(dialog).toContainText(
        'Lưu ý: Đây là số điện thoại người nhận ghi trên đơn hàng Shopee (có thể khác SĐT tài khoản hiện tại của bạn).',
      );
      await expect(dialog.getByRole('button', { name: 'Xác nhận & Tích điểm' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Quét đơn khác' })).toBeVisible();
      await expect(page.getByTestId('claim-error')).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot(page, `web${width}-quet-ma-phone-confirm`);

      await field.fill('8326');
      await dialog.getByRole('button', { name: 'Xác nhận & Tích điểm' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('claim-result')).toContainText('1.250 Điểm Xanh đang chờ cộng');
      expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([
        { code: 'SPXVN0123456789', via: 'typed' },
        { code: 'SPXVN0123456789', via: 'typed', recipientPhoneLast4: '8326' },
      ]);
      await shot(page, `web${width}-quet-ma-phone-confirmed`);
    });
  }

  test('375px Lazada: sai thì báo còn 2 lượt kèm lối nhắn CSKH; sai lần 3 khoá đơn, nút xác nhận tắt', async ({ page, api }) => {
    await loggedIn(page, api, '0901234567');
    mockExternalPoints(api, {
      submit: [
        required('lazada'),
        { rejectCode: 'PHONE_CONFIRM_WRONG', status: 403, message: '4 số cuối SĐT người nhận chưa khớp đơn sàn.', extra: { channel: 'lazada', requiredDigits: 4, remainingAttempts: 2 } },
        {
          rejectCode: 'PHONE_CONFIRM_LOCKED', status: 429, message: 'Bạn đã nhập sai 4 số cuối SĐT người nhận 3 lần.',
          extra: { channel: 'lazada', requiredDigits: 4, remainingAttempts: 0 },
        },
      ],
    });
    quietShell(api);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quet-ma');
    await page.getByTestId('claim-manual-toggle').click({ timeout: 20_000 });
    await page.getByLabel('Hoặc nhập mã vận đơn').fill('LZDVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận SĐT nhận hàng' });
    const field = dialog.getByLabel('Nhập 4 số cuối SĐT nhận hàng trên đơn Lazada');
    await field.fill('9921');
    await dialog.getByRole('button', { name: 'Xác nhận & Tích điểm' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('4 số cuối chưa khớp (còn 2 lượt thử)');
    await expect(dialog.getByRole('link', { name: 'Nhắn CSKH Tubu' })).toHaveAttribute('href', /zalo\.me\//);
    await expect(field).toHaveValue('');
    await shot(page, 'web375-quet-ma-phone-wrong');
    await field.fill('1111');
    await dialog.getByRole('button', { name: 'Xác nhận & Tích điểm' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Bạn đã nhập sai 3 lần. Thử lại đơn này sau 24 giờ hoặc nhắn CSKH.');
    await expect(field).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Xác nhận & Tích điểm' })).toBeDisabled();
    await shot(page, 'web375-quet-ma-phone-locked');
    await dialog.getByRole('button', { name: 'Quét đơn khác' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.callsTo('POST', '/me/external-points/claims')).toHaveLength(3);
  });

  test('375px đã có đơn sàn: hướng dẫn gập một dòng, khung quét lên sát đầu màn', async ({ page, api }) => {
    await loggedIn(page, api, '0901234567');
    mockExternalPoints(api, {
      claims: {
        data: [
          {
            id: 'a', kind: 'SCAN', channel: 'Shopee', maskedCode: 'SPX***001', state: 'CREDITED', points: 300, expectedCreditAt: null,
            creditedAt: '2026-11-05T01:00:00Z', holdUntil: null, createdAt: '2026-10-20T00:00:00Z',
          },
        ],
        meta: { page: 1, limit: 10, total: 1 },
        searching: [],
      } as never,
    });
    quietShell(api);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quet-ma');
    const toggle = page.getByTestId('scan-guide-toggle');
    await expect(toggle).toHaveText('Hướng dẫn quét mã', { timeout: 20_000 });
    await expect(page.getByTestId('scan-guide')).toHaveCount(0);
    await shot(page, 'web375-quet-ma-guide-collapsed');
    await toggle.click();
    await expect(page.getByTestId('scan-guide').locator('li')).toHaveCount(3);
  });
});

