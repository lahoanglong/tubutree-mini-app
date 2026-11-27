import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { seedSession } from './support/a11y-buyer';
import { mockExternalPoints } from './support/external-points-mocks';
import { mockNoSession } from './support/flash-slot-mocks';

/**
 * Web `/quet-ma` quét và tích điểm đơn sàn ngay trên web (W44 U5): khách chưa đăng nhập thấy một nút chính "Đăng nhập để tích điểm" quay lại
 * đúng trang (giữ utm_source, card); khách đã đăng nhập có ô nhập mã, kết quả, nút mua sắm theo điểm đang có và "Lịch sử tích điểm đơn sàn";
 * tài khoản chưa có SĐT thấy lời nhắc xác minh thay cho ô nhập. Camera trình duyệt (BarcodeDetector) kiểm ở spec thành phần.
 * Đặt QUET_MA_SHOTS_DIR để chụp ảnh 360px và 375px.
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

async function loggedIn(page: Page, api: MockApi, phone: string | null): Promise<void> {
  const user = mockSession(api, makeUser({ id: 'u-quet-ma', fullName: 'Nguyễn Văn An', phone: phone ?? undefined }));
  api.get('/me', { id: user.id, fullName: user.fullName, email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], phone });
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

    test(`${width}px đã đăng nhập: gõ mã, gửi, thấy kết quả, nút "Dùng 1.200 Điểm Xanh đang có" và lịch sử`, async ({ page, api }) => {
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
      const input = page.getByLabel('Hoặc nhập mã vận đơn');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Lịch sử tích điểm đơn sàn' })).toBeVisible();
      await shot(page, `web${width}-quet-ma-authed`);
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

  test('375px tài khoản chưa có SĐT: lời nhắc cần SĐT đã xác minh, nút chính mở Zalo, không có ô nhập', async ({ page, api }) => {
    await loggedIn(page, api, null);
    mockExternalPoints(api);
    quietShell(api);
    await page.goto('/quet-ma');
    const prompt = page.getByTestId('scan-phone-prompt');
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt.getByText('Cần số điện thoại đã xác minh')).toBeVisible();
    await expect(prompt.getByRole('link', { name: 'Xác minh số trên Zalo' })).toHaveAttribute('href', /zalo\.me\/s\/\d+\/points\/scan/);
    await expect(page.getByLabel('Hoặc nhập mã vận đơn')).toHaveCount(0);
    await shot(page, 'web375-quet-ma-no-phone');
  });
});
