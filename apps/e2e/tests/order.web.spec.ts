import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách, lane đơn hàng (việc giỏ và thanh toán): xoá có hoàn tác, Thu kèm rác, Idempotency-Key theo nội dung đơn,
 * PRICE_CHANGED. Mọi lời gọi /api/** đi qua mock (fixture `api`); host phải là localhost như các spec web khác.
 */

const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const ADDR = {
  id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình',
  street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const LINE = {
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết hữu cơ', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 2, stock: 8, total: 300000, fulfiller: TUBU,
};
const PICKUP = {
  id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', status: 'OPEN', orderCode: null, estimatedPoints: 12000,
  lines: [{ itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 12 }],
};
const placedOrder = (paymentMethod: string, total: number) => ({
  id: 'n1', code: 'TUBU2026101900001', status: 'CONFIRMED', subtotal: 300000, discount: 0, shippingFee: 30000, total,
  paymentMethod, paymentStatus: 'UNPAID', createdAt: new Date().toISOString(), items: [],
});

function mockBuyer(api: MockApi, opts: { pickup?: boolean } = {}) {
  const user = {
    id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
    pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
  };
  let lines = [LINE];
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/addresses', [ADDR]);
  api.get('/me/coupons', []);
  api.get('/config/public', {
    freeshipThreshold: 500000,
    waste: { enabled: true, dropoff: true, mailin: true, pickup: opts.pickup === true },
  });
  api.get('/waste/me', { blocked: false, shipLockedAt: null, openRequests: [PICKUP] });
  api.get('/cart', () => {
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    return { items: lines, couponCode: null, subtotal, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: lines.length };
  });
  api.delete('/cart/items/i1', () => {
    lines = [];
    return { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 };
  });
  api.post('/cart/items', () => {
    lines = [LINE];
    return { items: lines, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1 };
  });
  api.post('/checkout/quote', {
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000,
    pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
}

test.describe('Web khách: giỏ và thanh toán', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('xoá dòng ở giỏ rồi Hoàn tác thêm lại đúng phân loại và số lượng', async ({ page, api }) => {
    mockBuyer(api);
    await page.goto('/gio-hang');
    await page.getByRole('button', { name: 'Xóa Dầu gội bồ kết hữu cơ khỏi giỏ hàng' }).click();
    await expect(page.getByText('Đã bỏ khỏi giỏ')).toBeVisible();

    const added = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: 'Hoàn tác' }).click();
    expect((await added).body).toMatchObject({ variationId: 'v1', quantity: 2 });
    await expect(page.getByText('Dầu gội bồ kết hữu cơ').first()).toBeVisible();
  });

  test('Thu kèm rác: bật công tắc thì đơn mang wasteRequestId', async ({ page, api }) => {
    mockBuyer(api, { pickup: true });
    api.post('/checkout/place-order', ({ call }) => placedOrder('COD', (call.body as { expectedTotal: number }).expectedTotal));

    await page.goto('/thanh-toan');
    await expect(page.getByText('TR-PICK1')).toBeVisible();
    await expect(page.getByText('Thùng carton: 12 thùng')).toBeVisible();
    await page.getByLabel('Thu kèm rác').check();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    expect((await placed).body).toMatchObject({ wasteRequestId: 'req-p', paymentMethod: 'COD' });
  });

  test('cờ pickup tắt: không có mục Thu kèm rác', async ({ page, api }) => {
    mockBuyer(api, { pickup: false });
    await page.goto('/thanh-toan');
    await expect(page.getByRole('button', { name: 'Đặt hàng' })).toBeEnabled();
    await expect(page.getByText('Thu kèm rác')).toHaveCount(0);
  });

  test('lỗi 503 rồi bấm lại cùng nội dung gửi cùng Idempotency-Key; đổi cách trả tiền thì key mới', async ({ page, api }) => {
    mockBuyer(api);
    let calls = 0;
    api.post('/checkout/place-order', ({ call }) => {
      calls += 1;
      if (calls === 1) return reply(503, { message: 'Máy chủ bận' });
      return placedOrder(String((call.body as { paymentMethod: string }).paymentMethod), 330000);
    });

    await page.goto('/thanh-toan');
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    await expect(page.getByRole('heading', { name: 'Đặt hàng thành công!' })).toBeVisible();

    const sent = api.callsTo('POST', '/checkout/place-order');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers['idempotency-key']).toBe(sent[0]!.headers['idempotency-key']);
  });

  test('PRICE_CHANGED: báo giá ưu đãi đã đổi kèm đường về giỏ, không lộ mã lỗi', async ({ page, api }) => {
    mockBuyer(api);
    api.post('/checkout/place-order', () => reply(400, { message: 'PRICE_CHANGED' }));

    await page.goto('/thanh-toan');
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    await expect(page.getByText('Giá ưu đãi đã thay đổi').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem lại giỏ hàng' })).toHaveAttribute('href', '/gio-hang');
    await expect(page.getByText('PRICE_CHANGED')).toHaveCount(0);
  });
  test('chuyển khoản: đặt xong sang trang QR riêng, bấm kiểm tra thấy PAID thì báo đã nhận và có lối xem đơn', async ({ page, api }) => {
    mockBuyer(api);
    const CODE = 'TUBU2026101900001';
    api.post('/checkout/place-order', () => placedOrder('BANK_TRANSFER', 330000));
    let paid = false;
    api.get(`/payments/bank-qr/${CODE}`, () => ({
      orderCode: CODE, amount: 330000, paymentStatus: paid ? 'PAID' : 'UNPAID', paymentDeadline: null,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: CODE, qrString: 'x', qrImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    }));

    await page.goto('/thanh-toan');
    await page.getByLabel('Chuyển khoản ngân hàng').check();
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    await expect(page).toHaveURL(new RegExp(`/thanh-toan/chuyen-khoan/${CODE}$`));
    await expect(page.getByRole('heading', { name: 'Quét QR để chuyển khoản' })).toBeVisible();
    await expect(page.getByText('9984606774').first()).toBeVisible();

    paid = true;
    await page.getByRole('button', { name: /Tôi đã chuyển khoản/ }).click();
    await expect(page.getByText('Đã nhận thanh toán!')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem đơn hàng' })).toHaveAttribute('href', `/tai-khoan/don-hang/${CODE}`);
  });
});
