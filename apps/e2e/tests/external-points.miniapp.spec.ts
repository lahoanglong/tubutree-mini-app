import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockExternalPoints } from './support/external-points-mocks';
import { tourEntries } from './support/tour';
import { mockTourWorld } from './support/tour-world';

/**
 * Zalo Mini App E2E - Tích điểm đơn sàn bằng mã vận đơn (B6 bước 2, trang /points/scan).
 * Kiểm: dải "gấp đôi" lấy số từ config, gửi mã thành công hiện sàn/điểm chờ/mốc cộng, lỗi theo `code` hiện câu của app,
 * cờ tắt thì báo chưa mở.
 */
// Mốc tương lai tính từ giờ chạy, đúng 12:00 UTC để ngày hiển thị giống nhau ở mọi múi giờ phổ biến.
const FUTURE = new Date(Date.now() + 7 * 864e5);
FUTURE.setUTCHours(12, 0, 0, 0);
const pad2 = (n: number) => String(n).padStart(2, '0');
const FUTURE_LABEL = `${pad2(FUTURE.getUTCDate())}/${pad2(FUTURE.getUTCMonth() + 1)}/${FUTURE.getUTCFullYear()}`;
// Đặt EXT_POINTS_SHOTS_DIR để chụp ảnh màn quét (W44: nút lùi, nút sau khi quét).
const SHOTS = process.env.EXT_POINTS_SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe('Zalo Mini App E2E - Tích điểm đơn sàn', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-ext', fullName: 'Nguyễn Văn A' }));
  });

  test('gửi mã thành công: dải gấp đôi, kết quả có sàn, điểm chờ và mốc dự kiến', async ({ page, api }) => {
    mockExternalPoints(api, {
      submit: {
        status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
        expectedCreditAt: FUTURE.toISOString(), message: 'ok',
      },
    });
    await page.goto('/points/scan');

    await expect(page.getByText('Mua trong Mini App: tích gấp đôi')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Đơn sàn 1% · Mua trong Mini App từ 2%, nhân theo hạng')).toBeVisible();

    await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm' }).click();

    const result = page.getByTestId('claim-result');
    await expect(result).toContainText('Đã ghi nhận đơn Shopee SPX***789');
    await expect(result).toContainText('1.250 Điểm Xanh đang chờ cộng');
    await expect(result).toContainText(`Dự kiến cộng từ ${FUTURE_LABEL}`);
    expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([{ code: 'SPXVN0123456789', via: 'typed' }]);
  });

  test('mã đã tích: hiện câu tiếng Việt theo code, không có khối kết quả', async ({ page, api }) => {
    mockExternalPoints(api, { submit: { rejectCode: 'ALREADY_CLAIMED', status: 409, message: 'Mã này đã được tích điểm.' } });
    await page.goto('/points/scan');

    await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Mã này đã được dùng để tích điểm trước đó.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('claim-result')).toHaveCount(0);
  });

  test('mã đang có người khác chờ: hiện câu CLAIMED_BY_OTHER, không có dòng đang tìm hay đã ghi nhận', async ({ page, api }) => {
    mockExternalPoints(api, {
      submit: {
        status: 'CLAIMED_BY_OTHER', claimId: null, channel: null, maskedCode: 'SPX***789', points: null,
        expectedCreditAt: null, message: 'Mã này đang được một tài khoản khác dùng để tích điểm.',
      },
    });
    await page.goto('/points/scan');

    await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm' }).click();

    const result = page.getByTestId('claim-result');
    await expect(result).toContainText('Mã này đang được một tài khoản khác dùng để tích điểm. Nếu đây là đơn của bạn, liên hệ CSKH.', { timeout: 15_000 });
    await expect(result).not.toContainText('Chưa thấy đơn này');
    await expect(result).not.toContainText('Đã ghi nhận đơn');
    expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([{ code: 'SPXVN0123456789', via: 'typed' }]);
  });

  test('cờ tắt: vào thẳng URL thì báo chưa mở', async ({ page, api }) => {
    mockExternalPoints(api, { enabled: false });
    await page.goto('/points/scan');

    await expect(page.getByText('Chưa mở', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Tích điểm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Về trang chủ' })).toBeVisible();
  });

  test.describe('vào từ thẻ trong hộp hàng', () => {
    test('link thẻ: lời chào theo sàn, ba bước, nút quét là nút chính; nhãn nguồn và đợt thẻ đi kèm sự kiện', async ({ page, api }) => {
      mockExternalPoints(api);
      await page.goto('/points/scan?src=shopee&card=2611');

      const welcome = page.getByTestId('card-welcome');
      await expect(welcome).toContainText('Cảm ơn bạn đã mua Tubu Tree trên Shopee', { timeout: 15_000 });
      // Ba bước nằm ở hướng dẫn chung đầu màn (W42), gọn dưới 120px; lời chào không lặp lại.
      const guide = page.getByTestId('scan-guide');
      await expect(guide.locator('li')).toHaveCount(3);
      await expect(guide).toContainText('Quét mã vận đơn Shopee, TikTok, Lazada');
      await expect(guide).toContainText('Tích 1% giá trị đơn thành Điểm Xanh');
      expect((await guide.boundingBox())!.height).toBeLessThanOrEqual(120);
      await expect(welcome).not.toContainText('1. ');
      const scan = page.getByRole('button', { name: 'Quét mã trên nhãn' });
      await expect(scan).toBeVisible();
      const [scanBox, submitBox] = await Promise.all([scan.boundingBox(), page.getByRole('button', { name: 'Tích điểm' }).boundingBox()]);
      expect(scanBox!.y).toBeLessThan(submitBox!.y);
      expect(scanBox!.width).toBeGreaterThan(submitBox!.width * 0.9);

      // Sự kiện gom lô, gửi mỗi 10 giây.
      await expect
        .poll(() => api.callsTo('POST', '/events').flatMap((c) => (c.body as { events: { entrySource?: string; campaign?: string }[] }).events), { timeout: 25_000 })
        .toEqual(expect.arrayContaining([expect.objectContaining({ entrySource: 'shopee', campaign: 'card-2611' })]));
    });

    test('?code= điền sẵn mã vào ô và không tự gửi', async ({ page, api }) => {
      mockExternalPoints(api);
      await page.goto('/points/scan?src=lazada&card=2611&code=spx-vn-0123456789');
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveValue('SPXVN0123456789', { timeout: 15_000 });
      await page.waitForTimeout(500);
      expect(api.callsTo('POST', '/me/external-points/claims')).toHaveLength(0);
    });

    test('khách chưa có SĐT: câu giải thích hiện sẵn trước khi xin', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'user-nophone', phone: null }));
      mockExternalPoints(api);
      await page.goto('/points/scan?src=tiktok&card=2611');
      await expect(page.getByText('Tubu dùng số điện thoại Zalo của bạn để ghép đúng đơn và báo khi điểm được cộng.')).toBeVisible({ timeout: 15_000 });
    });

    test('quét ngoài Zalo không đọc được: báo nhập tay, mã gõ sẵn vẫn giữ', async ({ page, api }) => {
      mockExternalPoints(api);
      await page.goto('/points/scan?src=shopee&card=2611');
      await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
      await page.getByRole('button', { name: 'Quét mã trên nhãn' }).click();
      await expect(page.getByRole('alert')).toContainText('Bạn nhập mã bằng tay', { timeout: 15_000 });
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveValue('SPXVN0123456789');
    });

    test('cờ tắt mà vào từ thẻ: "sắp mở", có nút Xem sản phẩm và Về trang chủ', async ({ page, api }) => {
      mockExternalPoints(api, { enabled: false });
      await page.goto('/points/scan?src=shopee&card=2611');
      await expect(page.getByText('Tích điểm đơn sàn sắp mở')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Xem sản phẩm' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Về trang chủ' })).toBeVisible();
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveCount(0);
    });
  });

  test.describe('nút lùi (W44 U3)', () => {
    test('vào từ trang sản phẩm (sheet Điểm Xanh): có nút lùi, tiêu đề không bị đè, bấm thì về đúng trang sản phẩm', async ({ page, api }) => {
      const entry = tourEntries().find((e) => e.key === '/product/:slug')!;
      mockTourWorld(api, makeUser({ id: 'user-ext', fullName: 'Nguyễn Văn A' }));
      entry.setup?.(api);
      mockExternalPoints(api);
      await page.goto(entry.miniapp);
      const earn = page.locator('.tubu-points-earn');
      await expect(earn).toBeVisible({ timeout: 15_000 });
      const pdpPath = new URL(page.url()).pathname;
      await earn.click();
      await page.getByRole('button', { name: 'Gửi đơn sàn để tích điểm' }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/points/scan');
      // Chờ màn quét dựng xong và sheet đã đóng: nút lùi kiểm dưới phải là của màn quét, không phải của trang sản phẩm đang rời đi.
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('points-earn-popup')).toHaveCount(0);
      await expect(page.locator('.tubu-points-earn')).toHaveCount(0);
      const back = page.getByRole('button', { name: 'Quay lại' });
      await expect(back).toHaveCount(1);
      await expect(back).toBeVisible();
      // Tiêu đề lùi sang phải nhường chỗ nút lùi nổi, không bị đè.
      await shot(page, 'mini375-scan-from-pdp');
      const backBox = (await back.boundingBox())!;
      const titleBox = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
      expect(titleBox.x).toBeGreaterThanOrEqual(backBox.x + backBox.width - 1);
      await back.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(pdpPath);
    });

    test('vào thẳng URL (như bấm tab giữa): tab gốc, không có nút lùi', async ({ page, api }) => {
      mockExternalPoints(api);
      await page.goto('/points/scan');
      await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Quay lại' })).toHaveCount(0);
      await shot(page, 'mini375-scan-from-tab');
    });
  });

  test.describe('nút sau khi quét nói số điểm đang có (W44 U2)', () => {
    const CLAIMED = {
      status: 'CLAIMED' as const, claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
      expectedCreditAt: FUTURE.toISOString(), message: 'ok',
    };
    for (const width of [360, 375]) {
      test(`${width}px có 1.200 điểm dùng được: "Dùng 1.200 Điểm Xanh đang có" vừa một dòng`, async ({ page, api }) => {
        mockExternalPoints(api, { submit: CLAIMED });
        api.get('/me/loyalty', { pointsBalance: 1000, pointsMarketplaceBalance: 200, lockedPoints: 0 });
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/points/scan');
        await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
        await page.getByRole('button', { name: 'Tích điểm' }).click();
        const cta = page.getByRole('button', { name: 'Dùng 1.200 Điểm Xanh đang có' });
        await expect(cta).toBeVisible({ timeout: 15_000 });
        expect((await cta.boundingBox())!.height).toBeLessThanOrEqual(52);
        await shot(page, `mini${width}-scan-cta-points`);
      });
    }

    test('chưa có điểm dùng được: "Mua sắm ngay trên Mini App"', async ({ page, api }) => {
      mockExternalPoints(api, { submit: CLAIMED });
      api.get('/me/loyalty', { pointsBalance: 0, lockedPoints: 0 });
      await page.goto('/points/scan');
      await page.getByLabel('Hoặc nhập mã vận đơn').fill('SPXVN0123456789');
      await page.getByRole('button', { name: 'Tích điểm' }).click();
      await expect(page.getByRole('button', { name: 'Mua sắm ngay trên Mini App' })).toBeVisible({ timeout: 15_000 });
      await shot(page, 'mini375-scan-cta-zero');
    });
  });
});
