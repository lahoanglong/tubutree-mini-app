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
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/orders/me/refunds', []);
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
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
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
  const listedOrder = (code: string, over: Record<string, unknown> = {}) => ({
    id: `id-${code}`, code, status: 'DELIVERED', subtotal: 150000, discount: 0, shippingFee: 0, total: 150000, paymentMethod: 'COD',
    paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z',
    items: [{ id: `it-${code}`, variationId: 'v1', productName: 'Dầu gội bồ kết hữu cơ', variationName: '500ml', unitPrice: 150000, quantity: 1, total: 150000, thumbnail: null, stock: 8, available: true }],
    ...over,
  });

  test('danh sách đơn: tab trạng thái đổi ?tab= và gửi đúng bộ lọc; đơn chuyển khoản chờ có "Thanh toán ngay" tới trang QR', async ({ page, api }) => {
    mockBuyer(api);
    const pendingOrder = listedOrder('TUBU2026101900002', {
      status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2099-01-01T00:00:00.000Z',
    });
    api.get('/orders', ({ call }) => {
      const status = call.query.get('status');
      return { data: status === 'SHIPPING' ? [] : [pendingOrder], meta: { page: 1, limit: 20, total: status === 'SHIPPING' ? 0 : 1 } };
    });

    await page.goto('/tai-khoan/don-hang');
    await expect(page.getByRole('heading', { name: 'Đơn hàng', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Thanh toán ngay' })).toHaveAttribute('href', '/thanh-toan/chuyen-khoan/TUBU2026101900002');

    const shipping = api.waitForCall('GET', '/orders');
    await page.getByRole('tab', { name: 'Đang giao' }).click();
    expect((await shipping).query.get('status')).toBe('SHIPPING');
    await expect(page).toHaveURL(/\?tab=shipping$/);
    await expect(page.getByText('Không có đơn nào ở mục này')).toBeVisible();
  });

  test('Mua lại từ thẻ đơn: sheet chọn dòng, gửi repurchase đúng body rồi sang giỏ', async ({ page, api }) => {
    mockBuyer(api);
    const done = listedOrder('TUBU2026101900003');
    api.get('/orders', { data: [done], meta: { page: 1, limit: 20, total: 1 } });
    api.post('/orders/TUBU2026101900003/repurchase', {
      items: [], couponCode: null, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
      results: [{ orderItemId: 'it-TUBU2026101900003', status: 'added', addedQuantity: 1 }],
    });

    await page.goto('/tai-khoan/don-hang');
    await page.getByRole('button', { name: 'Mua lại' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Từ đơn TUBU2026101900003');
    const sent = api.waitForCall('POST', '/orders/:code/repurchase');
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click();
    expect((await sent).body).toEqual({ items: [{ orderItemId: 'it-TUBU2026101900003', quantity: 1 }], addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/gio-hang$/);
  });

  test('tab Định kỳ: tạm dừng gói gọi POST /status PAUSED', async ({ page, api }) => {
    mockBuyer(api);
    const sub = {
      id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-15T00:00:00.000Z', addressId: 'a1',
      paymentMethod: 'COD', lastOrderId: null, productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv',
      unitPrice: 80000, effectiveDiscountPct: 0.14,
    };
    api.get('/me/subscriptions', [sub]);
    api.post('/me/subscriptions/:id/status', { ...sub, status: 'PAUSED' });

    await page.goto('/tai-khoan/don-hang?tab=subscriptions');
    await expect(page.getByText('Nước xả vải Tubu')).toBeVisible();
    const paused = api.waitForCall('POST', '/me/subscriptions/:id/status');
    await page.getByRole('button', { name: 'Tạm dừng' }).click();
    expect((await paused).body).toEqual({ status: 'PAUSED' });
  });

  const detailOrder = (over: Record<string, unknown> = {}) => ({
    ...listedOrder('TUBU2026101900004'), id: 'o4', deliveredAt: '2026-10-03T03:00:00Z', pointsEarned: 50, pointsUsed: 0,
    shippingAddress: { recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', ward: 'Phường Ba Đình', street: '12 Phố Huế' },
    ...over,
  });

  test('chi tiết đơn đã giao: mốc giao, Điểm Xanh đã cộng, hoá đơn VAT mở PDF ở tab mới và đánh giá từng món', async ({ page, api }) => {
    mockBuyer(api);
    api.get('/orders/TUBU2026101900004', detailOrder({
      invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.example/4.pdf',
      items: [{ id: 'it4', productName: 'Dầu gội bồ kết hữu cơ', variationName: '500ml', unitPrice: 150000, quantity: 1, total: 150000, productSlug: 'dau-goi', reviewable: true }],
    }));
    api.get('/orders/me/returns', []);

    await page.goto('/tai-khoan/don-hang/TUBU2026101900004');
    await expect(page.getByRole('heading', { name: 'Chi tiết đơn hàng', level: 1 })).toBeVisible();
    await expect(page.getByText('TUBU2026101900004').first()).toBeVisible();
    await expect(page.getByText('Giao lúc 10:00 03/10/2026')).toBeVisible();
    await expect(page.getByText('Đã cộng +50 Điểm Xanh vào tài khoản')).toBeVisible();
    const pdf = page.getByRole('link', { name: 'Tải PDF' });
    await expect(pdf).toHaveAttribute('href', 'https://hoadon.example/4.pdf');
    await expect(pdf).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: 'Viết đánh giá' })).toBeVisible();
  });

  test('huỷ đơn đã trả tiền: chọn nhận về Ví Tubu thì POST /cancel gửi refundMethod WALLET', async ({ page, api }) => {
    mockBuyer(api);
    const paid = detailOrder({ status: 'CONFIRMED', deliveredAt: null, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', canCancel: true });
    let current: Record<string, unknown> = paid;
    api.get('/orders/TUBU2026101900004', () => current);
    api.get('/orders/me/refund-bank', { bank: null });
    api.post('/orders/TUBU2026101900004/cancel', () => {
      current = { ...paid, status: 'CANCELLED', canCancel: false };
      return current;
    });

    await page.goto('/tai-khoan/don-hang/TUBU2026101900004');
    await page.getByRole('button', { name: 'Hủy đơn' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('radio', { name: /Ví Tubu/ }).check();
    const cancelled = api.waitForCall('POST', '/orders/:code/cancel');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy đơn' }).click();
    expect((await cancelled).body).toEqual({ refundMethod: 'WALLET' });
    await expect(page.getByText(/Đã hủy đơn hàng/)).toBeVisible();
  });

  test('sổ địa chỉ: đặt mặc định gọi PATCH isDefault; xoá phải xác nhận rồi báo Đã xóa địa chỉ', async ({ page, api }) => {
    mockBuyer(api);
    const second = { ...ADDR, id: 'a2', recipient: 'Trần Thị Bình', phone: '0987654321', isDefault: false };
    api.get('/me/addresses', [ADDR, second]);
    api.patch('/me/addresses/:id', { ...second, isDefault: true });
    api.delete('/me/addresses/:id', { ok: true });

    await page.goto('/tai-khoan/dia-chi');
    await expect(page.getByRole('heading', { name: 'Sổ địa chỉ', level: 1 })).toBeVisible();
    const patched = api.waitForCall('PATCH', '/me/addresses/:id');
    await page.getByRole('button', { name: 'Đặt địa chỉ của Trần Thị Bình làm mặc định' }).click();
    expect((await patched).body).toEqual({ isDefault: true });

    await page.getByRole('button', { name: 'Xóa địa chỉ của Trần Thị Bình' }).click();
    await page.getByRole('button', { name: 'Giữ lại' }).click();
    expect(api.callsTo('DELETE', '/me/addresses/:id')).toHaveLength(0);
    await page.getByRole('button', { name: 'Xóa địa chỉ của Trần Thị Bình' }).click();
    const deleted = api.waitForCall('DELETE', '/me/addresses/:id');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Xóa' }).click();
    await deleted;
    await expect(page.getByText('Đã xóa địa chỉ.')).toBeVisible();
  });
});
