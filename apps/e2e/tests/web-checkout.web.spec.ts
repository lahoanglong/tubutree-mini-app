import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: thanh toán bằng Ví Tubu, mua một phần giỏ và số dư làm mới sau khi đặt (R2-BUYERWEB-2/3/5/6).
 * Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`), nên spec không cần dữ liệu DB; chỉ phần Next gọi API
 * phía server (chân trang) vẫn đi tới API thật như các smoke khác. Host phải là localhost (baseURL) vì middleware coi
 * nhãn đầu của Host là subdomain gian hàng.
 */

const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const ADDR = {
  id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình',
  street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const LINES = [
  { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết hữu cơ', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 1, stock: 8, total: 150000, fulfiller: TUBU },
  { id: 'i2', variationId: 'v2', productName: 'Xà phòng thảo mộc', variationName: '100g', slug: 'xa-phong', thumbnail: null, unitPrice: 50000, quantity: 2, stock: 5, total: 100000, fulfiller: TUBU },
];

interface Balances {
  wallet: number;
  points: number;
}

function mockBuyer(api: MockApi, balances: Balances) {
  const user = () => ({
    id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
    pointsBalance: balances.points, pointsConvertedBalance: 0, walletBalance: balances.wallet,
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: user() }));
  api.get('/me', () => user());
  api.get('/me/addresses', [ADDR]);
  api.get('/me/coupons', []);
  api.get('/config/public', { freeshipThreshold: 500000 });
  api.get('/cart', () => {
    const subtotal = LINES.reduce((s, l) => s + l.total, 0);
    return { items: LINES, couponCode: null, subtotal, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 3 };
  });
  api.post('/checkout/quote', ({ call }) => {
    const ids = (call.body as { itemIds?: string[] }).itemIds;
    const subtotal = LINES.filter((l) => !ids || ids.includes(l.id)).reduce((s, l) => s + l.total, 0);
    return {
      subtotal, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: subtotal + 30000,
      pointsEarned: 0, pointsBalance: balances.points, redeemablePoints: balances.points,
    };
  });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: balances.points, pointsConvertedBalance: 0 });
  api.get('/me/notifications', []);
  api.get('/auth/me', () => ({ ...user(), ownsBrand: false }));
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
}

test.describe('Web khách: thanh toán', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('đặt đơn bằng Ví Tubu rồi số dư ở Tài khoản giảm ngay, không chờ làm mới trang', async ({ page, api }) => {
    const balances: Balances = { wallet: 500000, points: 0 };
    mockBuyer(api, balances);
    const placedOrder = (total: number, paymentMethod: string) => ({
      id: 'n1', code: 'TUBU2026101499999', status: 'CONFIRMED', subtotal: 250000, discount: 0, shippingFee: 30000,
      total, paymentMethod, paymentStatus: 'PAID', createdAt: new Date().toISOString(), items: [],
    });
    api.post('/checkout/place-order', ({ call }) => {
      const body = call.body as { paymentMethod: string; expectedTotal: number };
      if (body.paymentMethod === 'WALLET') balances.wallet -= body.expectedTotal;
      return placedOrder(body.expectedTotal, body.paymentMethod);
    });
    api.get('/orders/TUBU2026101499999', () => placedOrder(280000, 'WALLET'));
    api.get('/orders/me/refunds', []);

    await page.goto('/thanh-toan');
    const wallet = page.getByRole('radio', { name: /Ví Tubu/ });
    await expect(wallet).toBeEnabled();
    await expect(page.getByText('Ví Tubu (500.000đ)')).toBeVisible();
    await wallet.check();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    const body = (await placed).body as { paymentMethod: string; expectedTotal: number };
    expect(body.paymentMethod).toBe('WALLET');
    expect(body.expectedTotal).toBe(280000);

    await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible();
    const desktop = (page.viewportSize()?.width ?? 0) >= 768;
    await expect(page.getByTestId('order-success-desktop')).toBeVisible({ visible: desktop });
    await expect(page.getByTestId('order-success-mobile')).toBeVisible({ visible: !desktop });
    // Đi bằng điều hướng phía client (không goto) để kiểm số dư mới mà không tải lại trang. Trang Tài khoản tự lấy lại /me khi mở nên ca này không bắt riêng việc thiếu invalidateBalances.
    if (desktop) await page.getByRole('link', { name: 'Đơn của tôi' }).click();
    else await page.getByRole('button', { name: 'Theo dõi đơn' }).click();
    await expect(page).toHaveURL(/\/tai-khoan\/don-hang/);
    // Chi tiết đơn ở điện thoại không có thanh tab (như Mini App); nút lùi về /tai-khoan bằng router.replace vì trang mở thẳng nên chưa có lịch sử trong web.
    if (desktop) await page.locator('a[href="/tai-khoan"]:visible').first().click();
    else await page.getByRole('button', { name: 'Quay lại' }).click();
    await expect(page).toHaveURL(/\/tai-khoan$/);
    await expect(page.getByText('220.000đ')).toBeVisible();
    await expect(page.getByText('500.000đ')).toHaveCount(0);
  });

  test('bỏ chọn một món ở giỏ: thanh toán chỉ báo giá và đặt đúng phần đã chọn', async ({ page, api }) => {
    mockBuyer(api, { wallet: 0, points: 0 });
    api.post('/checkout/place-order', ({ call }) => ({
      id: 'n2', code: 'TUBU2026101499998', status: 'CONFIRMED', subtotal: 150000, discount: 0, shippingFee: 30000,
      total: (call.body as { expectedTotal: number }).expectedTotal, paymentMethod: 'COD', paymentStatus: 'UNPAID',
      createdAt: new Date().toISOString(), items: [],
    }));

    await page.goto('/gio-hang');
    await page.getByLabel('Chọn Xà phòng thảo mộc để thanh toán').uncheck();
    await page.getByRole('link', { name: /^Thanh toán/ }).click();
    await expect(page).toHaveURL(/\/thanh-toan/);
    await expect(page.getByRole('button', { name: 'Đặt hàng' })).toBeEnabled();

    const quotes = api.callsTo('POST', '/checkout/quote');
    expect((quotes[quotes.length - 1]!.body as { itemIds?: string[] }).itemIds).toEqual(['i1']);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    const body = (await placed).body as { itemIds?: string[]; expectedTotal: number };
    expect(body.itemIds).toEqual(['i1']);
    expect(body.expectedTotal).toBe(180000);
  });

  test('mất mạng lúc khôi phục phiên: báo không kết nối kèm nút Thử lại, không mời đăng nhập', async ({ page, api }) => {
    mockBuyer(api, { wallet: 0, points: 0 });
    let down = true;
    const user = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
    api.post('/auth/refresh', () => (down ? reply(503, { message: 'down' }) : { accessToken: 'e2e-token', user }));

    await page.goto('/tai-khoan');
    await expect(page.getByText('Không kết nối được với Tubu Tree')).toBeVisible();
    await expect(page.getByRole('link', { name: /Đăng nhập/ })).toHaveCount(0);

    down = false;
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByRole('heading', { name: 'Cá nhân', level: 1 })).toBeVisible();
  });
});
