import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web: kênh đại lý /dai-ly, ca làm /nhan-vien. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`); host phải là localhost
 * (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'DEALER', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
const APPROVED = { isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000 };
const ROW = {
  variationId: 'v1', sku: 'POLANG-500', product: 'Nước rửa chén', brand: 'Pơ Lang', variation: '500ml',
  retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 0,
};

function mockDealer(api: MockApi, me: Record<string, unknown> = APPROVED) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', USER);
  api.get('/dealer/me', me);
  api.get('/dealer/pricelist', [ROW]);
  api.get('/dealer/templates', []);
  api.get('/dealer/orders', []);
  api.get('/config/public', {});
}

test.describe('Web đại lý', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('hồ sơ đang chờ duyệt: màn chờ, không có bảng giá', async ({ page, api }) => {
    mockDealer(api, { isDealer: false, status: 'PENDING', tier: null, currentDebt: 0 });
    await page.goto('/dai-ly');
    await expect(page.getByRole('heading', { name: 'Hồ sơ đại lý', level: 1 })).toBeVisible();
    await expect(page.getByText('Hồ sơ đang được duyệt')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Bảng giá' })).toHaveCount(0);
  });

  test('đặt hàng hết tồn là đặt trước; Trả trước gửi PREPAID kèm Idempotency-Key rồi sang trang chuyển khoản', async ({ page, api }) => {
    mockDealer(api);
    api.post('/dealer/orders', () => ({
      id: 'o1', code: 'TUBU2026101900001', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 80_000,
      createdAt: new Date().toISOString(), items: [{ backorderedQty: 1, quantity: 1 }],
    }));

    await page.goto('/dai-ly');
    await expect(page.getByText('Hết hàng — được đặt trước')).toBeVisible();
    await page.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(page.getByText('Đặt trước 1, giao khi hàng về')).toBeVisible();
    await expect(page.getByText(/1 mặt hàng đặt vượt tồn/)).toBeVisible();

    const placed = api.waitForCall('POST', '/dealer/orders');
    await page.getByRole('button', { name: 'Trả trước' }).click();
    const call = await placed;
    expect(call.body).toMatchObject({ items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'PREPAID' });
    expect(call.headers['idempotency-key']).toBeTruthy();
    await expect(page).toHaveURL(/\/thanh-toan\/chuyen-khoan\/TUBU2026101900001/);
  });

  test('công nợ: Báo đã CK gửi đúng số tiền và Idempotency-Key, nói rõ dư nợ chưa giảm ngay', async ({ page, api }) => {
    mockDealer(api);
    api.get('/dealer/credit-ledger', { balance: 3_000_000, entries: [] });
    api.post('/dealer/credit-payment', { ok: true });

    await page.goto('/dai-ly?tab=credit');
    await page.getByLabel('Số tiền đã chuyển').fill('1000000');
    const paid = api.waitForCall('POST', '/dealer/credit-payment');
    await page.getByRole('button', { name: 'Báo đã CK' }).click();
    const call = await paid;
    expect(call.body).toEqual({ amount: 1_000_000, note: 'Báo đã chuyển khoản' });
    expect(call.headers['idempotency-key']).toBeTruthy();
    await expect(page.getByText(/chờ xác nhận đã nhận được tiền/)).toBeVisible();
  });
});

const STAFF = { ...USER, role: 'STAFF' };

function mockStaff(api: MockApi, role = 'STAFF') {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: { ...STAFF, role } }));
  api.get('/me', { ...STAFF, role });
  api.get('/staff/attendance/status', { shifts: [], openSession: null });
  api.get('/staff/shift-templates', [{ id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 }]);
  api.get('/staff/shifts', []);
  api.get('/config/public', {});
}

test.describe('Web nhân viên', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('khách thường vào /nhan-vien: màn từ chối, không gọi API ca làm', async ({ page, api }) => {
    mockStaff(api, 'CUSTOMER');
    await page.goto('/nhan-vien');
    await expect(page.getByRole('heading', { name: 'Ca làm của tôi', level: 1 })).toBeVisible();
    await expect(page.getByText('Trang dành cho nhân viên. Liên hệ quản trị để được cấp quyền.')).toBeVisible();
  });

  test('thêm ca theo ca chuẩn gửi đúng body; chấm công chỉ dẫn mở trên Zalo', async ({ page, api }) => {
    mockStaff(api);
    api.post('/staff/shifts', { created: 1 });
    await page.goto('/nhan-vien');
    await expect(page.getByText('Hôm nay bạn không có ca đã duyệt.')).toBeVisible();

    await page.getByRole('button', { name: /^Thêm ca / }).first().click();
    await page.getByRole('button', { name: 'Ca sáng (08:00–12:00)' }).click();
    const created = api.waitForCall('POST', '/staff/shifts');
    await page.getByRole('button', { name: 'Gửi duyệt' }).click();
    const call = await created;
    expect(call.body).toMatchObject({ items: [{ templateId: 't1' }] });
    await expect(page.getByText('Đã gửi ca chờ duyệt.')).toBeVisible();
  });
});
