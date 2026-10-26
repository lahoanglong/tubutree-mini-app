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
  api.get('/auth/me', () => ({ ...me(), ownsBrand: false }));
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

  test('hub: thẻ hồ sơ, ba số dư, hàng trạng thái đơn, menu theo nhóm', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    await page.goto('/tai-khoan');

    await expect(page.getByRole('heading', { name: 'Cá nhân', level: 1 })).toBeVisible();
    const head = page.getByRole('link', { name: /Nguyễn Văn An/ });
    await expect(head).toHaveAttribute('href', '/tai-khoan/ho-so');
    await expect(head).toContainText('Hạt Giống');
    await expect(page.getByRole('link', { name: /Mã giảm giá/ })).toContainText('2 mã');
    await expect(page.getByRole('heading', { name: 'Kiếm tiền cùng Tubu', level: 2 })).toBeVisible();
    // Hàng trạng thái đơn ở đầu trang: mỗi ô mở danh sách đơn đã lọc theo trạng thái.
    await expect(page.getByRole('link', { name: /^Chờ thanh toán/ })).toHaveAttribute('href', '/tai-khoan/don-hang?tab=pending_payment');
    await expect(page.getByRole('link', { name: /^Định kỳ/ })).toHaveAttribute('href', '/tai-khoan/don-hang?tab=subscriptions');
    await expect(page.getByRole('link', { name: 'Sổ địa chỉ' })).toHaveAttribute('href', '/tai-khoan/dia-chi');
    // Điện thoại giống Mini App (hub không có khối đơn hàng); máy tính còn danh sách đơn.
    const narrow = (page.viewportSize()?.width ?? 1280) < 768;
    const orders = page.getByRole('heading', { name: /Đơn hàng của tôi/ });
    if (narrow) await expect(orders).toBeHidden();
    else await expect(orders).toBeVisible();
    // Khách thường không thấy nhóm công việc nội bộ.
    await expect(page.getByRole('heading', { name: 'Công việc', level: 2 })).toHaveCount(0);
    // Cờ ownsBrand=false trên /auth/me: khỏi hỏi /brand/owner/me (chờ /auth/me trả lời rồi mới đếm).
    await expect.poll(() => api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    expect(api.callsTo('GET', '/brand/owner/me')).toHaveLength(0);
  });

  test('hub: quản trị viên thấy nhóm Công việc', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Quản Trị', email: null, dob: null }, 'ADMIN');
    api.get('/affiliate/me', { isAffiliate: true, canRegister: false, canOpenStorefront: true });
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
    const narrow = (page.viewportSize()?.width ?? 1280) < 768;
    const phone = page.getByText('0912 345 678');
    if (narrow) await expect(phone).toBeHidden();
    else await expect(phone).toBeVisible();
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

  test('cài đặt: tắt Khuyến mãi gửi PATCH đúng thân, chọn cỡ chữ Lớn áp cho cả trang', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.get('/me/notifications/prefs', { notifyPromo: true, notifyGarden: true });
    api.patch('/me/notifications/prefs', ({ call }) => ({ notifyPromo: true, notifyGarden: true, ...(call.body as object) }));
    await page.goto('/tai-khoan/cai-dat');

    await expect(page.getByRole('heading', { name: 'Cài đặt', level: 1 })).toBeVisible();
    const promo = page.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' });
    await expect(promo).toHaveAttribute('aria-checked', 'true');
    const saved = api.waitForCall('PATCH', '/me/notifications/prefs');
    await promo.click();
    expect((await saved).body).toEqual({ notifyPromo: false });
    await expect(promo).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('radio', { name: /Lớn/ }).click();
    await expect(page.getByRole('radio', { name: /Lớn/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveCSS('font-size', '18px');
    await page.reload();
    await expect(page.locator('html')).toHaveCSS('font-size', '18px');
    await expect(page.getByRole('link', { name: /Sổ địa chỉ/ })).toHaveAttribute('href', '/tai-khoan/dia-chi');
  });

  test('cài đặt: lưu lỗi thì công tắc trở về như cũ và báo lỗi', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.get('/me/notifications/prefs', { notifyPromo: true, notifyGarden: true });
    api.patch('/me/notifications/prefs', () => reply(500, { message: 'lỗi' }));
    await page.goto('/tai-khoan/cai-dat');

    const promo = page.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' });
    await promo.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Chưa lưu được cài đặt' })).toBeVisible();
    await expect(promo).toHaveAttribute('aria-checked', 'true');
  });

  test('thông báo: chạm tin chưa đọc đánh dấu đã đọc, mở chi tiết và nút tới đơn; "Đọc tất cả" gọi read-all', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    const sentAt = new Date().toISOString();
    api.get('/me/notifications', [
      { id: 'n1', templateCode: 'ORDER_CONFIRMED', payload: { body: 'Đơn TT001 đã được xác nhận', data: { order_code: 'TT001' } }, status: 'SENT', sentAt },
      { id: 'n2', templateCode: 'POINTS_EARNED', payload: { body: 'Bạn nhận thêm 50 điểm Xanh' }, status: 'SENT', sentAt },
    ]);
    api.post('/me/notifications/:id/read', { ok: true });
    api.post('/me/notifications/read-all', { ok: true, count: 2 });
    await page.goto('/tai-khoan/thong-bao');

    await expect(page.getByRole('heading', { name: 'Thông báo', level: 1 })).toBeVisible();
    const read = api.waitForCall('POST', '/me/notifications/:id/read');
    await page.getByRole('button', { name: /Đơn TT001 đã được xác nhận/ }).click();
    expect((await read).path).toBe('/me/notifications/n1/read');
    const detail = page.getByRole('dialog', { name: 'Chi tiết thông báo' });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('link', { name: 'Xem chi tiết đơn hàng' })).toHaveAttribute('href', '/tai-khoan/don-hang/TT001');
    await detail.getByRole('button', { name: 'Đóng' }).click();

    const all = api.waitForCall('POST', '/me/notifications/read-all');
    await page.getByRole('button', { name: 'Đọc tất cả' }).click();
    await all;
  });

  test('thông báo khi chưa đăng nhập: mời đăng nhập và quay lại đúng trang', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/tai-khoan/thong-bao');
    await expect(page.getByRole('link', { name: /Đăng nhập với Zalo/ })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/thong-bao')}`);
  });

  test('giới thiệu: khách chưa đăng nhập xem FAQ, lọc nhóm, mở câu hỏi, liên hệ và link chính sách; không có Xoá tài khoản', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    api.get('/faqs', [
      { id: 'f1', category: 'Vận chuyển', question: 'Bao lâu thì nhận hàng?', answer: '2-4 ngày.' },
      { id: 'f2', category: 'Đổi trả', question: 'Đổi hàng thế nào?', answer: 'Trong 7 ngày.' },
    ]);
    api.get('/config/public', { support: { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null } });
    // Bản build render server bằng API thật rồi đưa kết quả vào initialData (staleTime 1 giờ) nên mock không được hỏi lại.
    // Đổi tên ba prop trong dữ liệu RSC để trình duyệt tự tải qua mock, như khi server đọc lỗi.
    await page.route('**/gioi-thieu', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const res = await route.fetch();
      const body = (await res.text()).replace(/initial(Faqs|Config|Support)(\\*"):/g, 'ignored$1$2:');
      return route.fulfill({ response: res, body });
    });
    await page.goto('/gioi-thieu');

    await expect(page.getByRole('heading', { name: 'Về Tubu Tree', level: 1 })).toBeVisible();
    const first = page.getByRole('button', { name: /Bao lâu thì nhận hàng/ });
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('2-4 ngày.')).toBeVisible();
    await page.getByRole('button', { name: 'Đổi trả' }).click();
    await expect(page.getByRole('button', { name: /Bao lâu thì nhận hàng/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Đổi hàng thế nào/ }).click();
    await expect(page.getByText('Trong 7 ngày.')).toBeVisible();

    await expect(page.getByRole('main').getByRole('link', { name: /Hotline/ })).toHaveAttribute('href', 'tel:0984606774');
    await expect(page.getByRole('main').getByRole('link', { name: 'tubutree@gmail.com' })).toHaveAttribute('href', 'mailto:tubutree@gmail.com');
    await expect(page.getByRole('main').getByRole('link', { name: 'Chính sách đổi trả' })).toHaveAttribute('href', '/chinh-sach/doi-tra');
    await expect(page.getByRole('button', { name: 'Xoá tài khoản' })).toHaveCount(0);
  });

  test('giới thiệu: đã đăng nhập gửi yêu cầu xoá tài khoản sau khi xác nhận', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.get('/cart', { items: [], itemCount: 0, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, couponCode: null });
    api.get('/faqs', []);
    api.get('/config/public', { support: { hotline: null, email: null, zaloOaName: null } });
    api.post('/me/deletion-request', { message: 'Đã ghi nhận yêu cầu xoá tài khoản' });
    api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
    await page.goto('/gioi-thieu');

    await expect(page.getByText('Tubu Tree bán những gì?')).toBeVisible();
    await page.getByRole('button', { name: 'Xoá tài khoản' }).click();
    await expect(page.getByText('Xoá tài khoản vĩnh viễn?')).toBeVisible();
    await expect(page.getByText(/Ví Tubu còn/)).toHaveCount(0);
    const sent = api.waitForCall('POST', '/me/deletion-request');
    await page.getByRole('button', { name: 'Gửi yêu cầu xoá' }).click();
    expect((await sent).body).toEqual({});
    await expect(page.getByRole('status').filter({ hasText: 'Đã ghi nhận yêu cầu xoá tài khoản' })).toBeVisible();
  });

  test('giới thiệu: Ví còn tiền phải tick đồng ý bỏ số dư; gửi kèm đúng số dư đã thấy', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.get('/cart', { items: [], itemCount: 0, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, couponCode: null });
    api.get('/faqs', []);
    api.get('/config/public', { support: { hotline: null, email: null, zaloOaName: null } });
    api.get('/me/wallet', { walletBalance: 50000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
    api.post('/me/deletion-request', { message: 'Đã ghi nhận yêu cầu xoá tài khoản' });
    await page.goto('/gioi-thieu');

    await page.getByRole('button', { name: 'Xoá tài khoản' }).click();
    await expect(page.getByText('Ví Tubu còn 50.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.')).toBeVisible();
    const send = page.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    await expect(send).toBeDisabled();
    await page.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }).check();
    await expect(send).toBeEnabled();
    const sent = api.waitForCall('POST', '/me/deletion-request');
    await send.click();
    expect((await sent).body).toEqual({ acknowledgedWalletBalance: 50000, acceptWalletForfeit: true });
    await expect(page.getByRole('status').filter({ hasText: 'Đã ghi nhận yêu cầu xoá tài khoản' })).toBeVisible();
  });

  test('nhận mã từ thẻ QR: đã đăng nhập thì POST /coupons/claim một lần, hiện ưu đãi và xoá ?claim= khỏi URL', async ({ page, api }) => {
    mockAccount(api, { fullName: 'Nguyễn Văn An', email: null, dob: null });
    api.get('/cart', { items: [], itemCount: 0, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, couponCode: null });
    api.post('/coupons/claim', {
      code: 'SHOPEE-AB12CD34', type: 'AMOUNT', value: 30000, minOrder: 99000, maxDiscount: null,
      endAt: '2026-12-31T16:59:59.000Z', newCustomerOnly: true, alreadyClaimed: false,
    });
    const claimed = api.waitForCall('POST', '/coupons/claim');
    await page.goto('/tai-khoan?claim=shopee-ab12cd34');

    expect((await claimed).body).toEqual({ code: 'SHOPEE-AB12CD34' });
    const sheet = page.getByRole('dialog', { name: 'Bạn nhận được ưu đãi' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Giảm 30.000đ cho đơn từ 99.000đ')).toBeVisible();
    await expect(page).not.toHaveURL(/claim=/);
    await sheet.getByRole('button', { name: 'Để sau' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('nhận mã từ thẻ QR khi chưa đăng nhập: mời đăng nhập, không gọi /coupons/claim', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/tai-khoan?claim=SHOPEE-AB12CD34');
    const sheet = page.getByRole('dialog', { name: 'Đăng nhập Zalo để nhận ưu đãi' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Đăng nhập với Zalo' })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan')}`);
  });

  test('onboarding: khách chưa làm quiz ở Trang chủ đi hết các bước và gửi đúng đáp án', async ({ page, api }) => {
    api.post('/auth/refresh', () => ({
      accessToken: 'e2e-token',
      user: { id: 'u1', fullName: 'An', avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0, referralCode: 'AN123' },
    }));
    api.get('/me', { id: 'u1', fullName: 'An', email: null, dob: null, avatarUrl: null, phone: '0912345678', onboarded: false, segments: [] });
    api.get('/cart', { items: [], itemCount: 0, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, couponCode: null });
    api.post('/me/onboarding', ({ call }) => ({ id: 'u1', onboarded: true, segments: (call.body as { segments: string[] }).segments }));
    // Trang chủ có thể gọi thêm vài API phụ không liên quan tới quiz.
    api.allowUnmocked('POST /events', 'GET /flash-sales/active', 'GET /me/coupons', 'POST /affiliate/touch',
      'GET /config/public', 'GET /me/purchased-items', 'GET /me/subscriptions', 'GET /flash-sales/upcoming', 'GET /me/new-customer-offer', 'GET /me/notifications', 'GET /products/for-you',
      'GET /me/wishlist/ids');
    await page.goto('/');

    const quiz = page.getByRole('dialog', { name: 'Chào mừng đến Tubu Tree' });
    await expect(quiz.getByRole('heading', { name: 'Chào mừng đến Tubu Tree!' })).toBeVisible();
    await quiz.getByRole('button', { name: 'Bắt đầu' }).click();
    await quiz.getByRole('checkbox', { name: 'Chăm sóc da' }).click();
    await quiz.getByRole('button', { name: 'Tiếp tục' }).click();
    await quiz.getByRole('radio', { name: 'Nhạy cảm' }).click();
    await quiz.getByRole('button', { name: 'Tiếp tục' }).click();
    await quiz.getByRole('checkbox', { name: 'Gia đình' }).click();
    await quiz.getByRole('button', { name: 'Tiếp tục' }).click();
    await quiz.getByRole('radio', { name: 'Giá tốt' }).click();
    const sent = api.waitForCall('POST', '/me/onboarding');
    await quiz.getByRole('button', { name: 'Hoàn tất' }).click();
    expect((await sent).body).toEqual({ segments: ['skincare', 'sensitive_skin', 'family', 'price'] });
    await expect(quiz.getByRole('heading', { name: 'Tuyệt vời!' })).toBeVisible();
    await quiz.getByRole('button', { name: 'Khám phá ngay' }).click();
    await expect(quiz).toHaveCount(0);
  });
});
