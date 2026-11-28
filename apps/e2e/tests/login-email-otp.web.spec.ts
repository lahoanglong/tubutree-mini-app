import type { Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * /dang-nhap khi ứng dụng Zalo chưa được duyệt (-14029): đăng nhập bằng mã 6 số gửi qua Email, lời báo Zalo đang chờ duyệt,
 * nút Google chỉ khi API có khoá. Mọi lời gọi /api/ đi qua mock nên không cần API/DB. Đo ở 360px và 375px;
 * đặt W54_SHOTS_DIR để chụp ảnh từng bước.
 */
const USER = { id: 'u-email', fullName: null, avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0, referralCode: 'EM1234' };
const GOOD_CODE = '246810';
const SHOTS = process.env.W54_SHOTS_DIR;

function mockLogin(api: MockApi, cfg: Record<string, unknown> = {}) {
  api.get('/config/public', { emailLoginConfigured: true, googleLoginConfigured: false, ...cfg });
  api.post('/auth/email-otp/request', ({ call }) => ({
    email: String((call.body as { email: string }).email).trim().toLowerCase(),
    resendAfterSec: 60,
    expiresInSec: 600,
  }));
  api.post('/auth/email-otp/verify', ({ call }) =>
    (call.body as { code: string }).code === GOOD_CODE
      ? { accessToken: 'e2e-email-token', refreshToken: '', user: USER }
      : reply(400, { statusCode: 400, error: 'Bad Request', code: 'EMAIL_OTP_WRONG', message: 'Mã chưa đúng. Bạn còn 4 lần thử.', attemptsLeft: 4 }),
  );
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [360, 375]) {
  test.describe(`/dang-nhap ở ${width}px`, () => {
    test.use({ viewport: { width, height: 780 } });
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại đặt riêng: chỉ chạy ở project Web Customer Mobile');
    });

    test('Email hai bước: nhận mã, sai mã báo lỗi và xoá ô, đúng mã thì đăng nhập rồi về trang cần quay lại', async ({ page, api }) => {
      mockLogin(api);
      await page.goto('/dang-nhap?returnTo=%2Fchinh-sach%2Fdieu-khoan');
      await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
      const emailSubmit = page.getByRole('button', { name: 'Nhận mã qua Email' });
      await expect(emailSubmit).toBeVisible();
      // Nút Zalo theo NEXT_PUBLIC_ZALO_APP_ID lúc build (cổng release build không đặt, PROD có): có thì phải là nút phụ nằm dưới nút Email.
      const zalo = page.getByRole('button', { name: 'Đăng nhập với Zalo' });
      if ((await zalo.count()) > 0) {
        await expect(zalo).toBeVisible();
        const [e, z] = await Promise.all([emailSubmit.boundingBox(), zalo.boundingBox()]);
        expect(z!.y).toBeGreaterThan(e!.y + e!.height);
      }
      await expect(page.getByRole('button', { name: 'Đăng nhập với Google' })).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, `w54-login-${width}-1-email`);

      await page.getByLabel('Email').fill('Khach.Hang@Gmail.com');
      await page.getByRole('button', { name: 'Nhận mã qua Email' }).click();
      const code = page.getByLabel('Mã đăng nhập');
      await expect(code).toBeFocused();
      await expect(code).toHaveAttribute('inputmode', 'numeric');
      await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await expect(page.getByText('khach.hang@gmail.com')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Gửi lại mã \(\d+ giây\)$/ })).toBeDisabled();
      await expectNoSideScroll(page);
      await shot(page, `w54-login-${width}-2-code`);

      await code.pressSequentially('111111');
      await expect(page.getByTestId('email-login').getByRole('alert')).toHaveText('Mã chưa đúng. Bạn còn 4 lần thử.');
      await expect(code).toHaveValue('');
      await shot(page, `w54-login-${width}-3-wrong`);

      await code.pressSequentially(GOOD_CODE);
      await page.waitForURL('**/chinh-sach/dieu-khoan');
      const verifies = api.callsTo('POST', '/auth/email-otp/verify');
      expect(verifies.map((c) => c.body)).toEqual([
        { email: 'khach.hang@gmail.com', code: '111111' },
        { email: 'khach.hang@gmail.com', code: GOOD_CODE },
      ]);
      // Header x-client: web bật chế độ cookie HttpOnly cho refresh token ở API, như đăng nhập Zalo trên web.
      expect(verifies.every((c) => c.headers['x-client'] === 'web')).toBe(true);
      // Trang đích sau đăng nhập không thuộc phạm vi spec này: các lời gọi của nó để 404 thay vì mock từng cái.
      await page.waitForLoadState('networkidle');
      api.allowUnmocked(...new Set(api.unmocked));
    });

    test('Zalo trả -14029: trang nhận mã đưa về /dang-nhap?zalo_unavailable=1, có lời báo, không còn nút Zalo', async ({ page, api }) => {
      mockLogin(api);
      await page.goto('/dang-nhap/callback?error=-14029&error_description=application%20is%20not%20approved');
      await page.waitForURL(/\/dang-nhap\?zalo_unavailable=1$/);
      await expect(page.getByTestId('zalo-unavailable')).toHaveText('Đăng nhập Zalo đang chờ duyệt — bạn đăng nhập nhanh bằng Email bên dưới nhé.');
      await expect(page.getByRole('button', { name: 'Đăng nhập với Zalo' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mở trên Zalo' })).toHaveCount(0);
      await expect(page.getByLabel('Email')).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, `w54-login-${width}-4-zalo-pending`);
    });

    test('API có khoá Google: thêm nút Google; bấm thì mở /auth/google/start với redirect_uri là trang /dang-nhap/google', async ({ page, api, baseURL }) => {
      mockLogin(api, { googleLoginConfigured: true });
      api.get('/auth/google/start', { ok: true });
      await page.goto('/dang-nhap');
      const google = page.getByRole('button', { name: 'Đăng nhập với Google' });
      await expect(google).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, `w54-login-${width}-5-google`);
      await google.click();
      await expect.poll(() => api.callsTo('GET', '/auth/google/start').length).toBe(1);
      const q = api.callsTo('GET', '/auth/google/start')[0]!.query;
      expect(q.get('redirect_uri')).toBe(new URL('/dang-nhap/google', baseURL).toString());
    });
  });
}
