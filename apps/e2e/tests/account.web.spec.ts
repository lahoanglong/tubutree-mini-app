import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: hub tài khoản và sửa hồ sơ. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`);
 * chưa cấu hình Cloudinary trong e2e nên phần đổi ảnh đại diện chỉ kiểm dòng giải thích (đường tải ảnh có test đơn vị).
 */

interface Profile {
  fullName: string | null;
  email: string | null;
  dob: string | null;
}

function mockAccount(api: MockApi, profile: Profile, role = 'CUSTOMER') {
  const me = () => ({
    id: 'u1', ...profile, avatarUrl: null, phone: '0912345678', role, referralCode: 'AN123', onboarded: true, segments: [],
    pointsBalance: 120, pointsConvertedBalance: 0, walletBalance: 50000,
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me() }));
  api.get('/me', () => me());
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 120, pointsConvertedBalance: 0 });
  api.get('/me/coupons', [{ id: 'c1', code: 'A' }, { id: 'c2', code: 'B' }]);
  api.get('/me/notifications', [{ id: 'n1', templateCode: 'x', payload: {}, status: 'SENT', sentAt: new Date().toISOString() }]);
  api.get('/config/public', { aiAdvisorEnabled: false });
  api.get('/brand/owner/me', () => reply(404, { message: 'Không tìm thấy' }));
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
}

test.describe('Web khách: tài khoản', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('hub: thẻ hồ sơ, ba số dư, menu theo nhóm, danh sách đơn vẫn còn', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    await page.goto('/tai-khoan');

    await expect(page.getByRole('heading', { name: 'Tài khoản', level: 1 })).toBeVisible();
    const head = page.getByRole('link', { name: /Nguyễn Văn An/ });
    await expect(head).toHaveAttribute('href', '/tai-khoan/ho-so');
    await expect(head).toContainText('Hạt Giống');
    await expect(page.getByRole('link', { name: /Mã giảm giá/ })).toContainText('2 mã');
    await expect(page.getByRole('heading', { name: 'Tài sản', level: 2 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sổ địa chỉ' })).toHaveAttribute('href', '/tai-khoan/dia-chi');
    await expect(page.getByRole('heading', { name: /Đơn hàng của tôi/ })).toBeVisible();
    // Khách thường không thấy nhóm công việc nội bộ.
    await expect(page.getByRole('heading', { name: 'Công việc', level: 2 })).toHaveCount(0);
  });

  test('hub: quản trị viên thấy nhóm Công việc', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Quản Trị', email: null, dob: null }, 'ADMIN');
    await page.goto('/tai-khoan');
    await expect(page.getByRole('heading', { name: 'Công việc', level: 2 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Quản trị nhân sự/ })).toHaveAttribute('href', '/admin');
  });

  test('sửa hồ sơ: email sai bị chặn, email đúng gửi PATCH /me đúng thân', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.patch('/me', ({ call }) => ({ id: 'u1', ...(call.body as object) }));
    await page.goto('/tai-khoan/ho-so');

    await expect(page.getByRole('heading', { name: 'Sửa hồ sơ', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Họ và tên')).toHaveValue('Nguyễn Văn An');
    await expect(page.getByText('0912 345 678')).toBeVisible();
    await expect(page.getByText('dịch vụ lưu ảnh chưa được bật')).toBeVisible();

    const email = page.getByLabel('Email');
    await email.fill('khong-hop-le');
    await email.blur();
    await expect(page.getByText('Email không hợp lệ')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();

    await email.fill('an@tubu.vn');
    await page.getByLabel('Ngày sinh').fill('1990-05-01');
    const saved = api.waitForCall('PATCH', '/me');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    const body = (await saved).body as Record<string, unknown>;
    expect(body).toEqual({ fullName: 'Nguyễn Văn An', email: 'an@tubu.vn', dob: '1990-05-01' });
    await expect(page.getByText('Đã cập nhật hồ sơ')).toBeVisible();
  });

  test('sửa hồ sơ khi chưa đăng nhập: mời đăng nhập và quay lại đúng trang', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/tai-khoan/ho-so');
    const login = page.getByRole('link', { name: /Đăng nhập với Zalo/ });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/ho-so')}`);
  });
});
