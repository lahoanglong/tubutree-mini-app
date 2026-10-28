import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web: kênh đại lý /dai-ly,  ca làm /nhan-vien, bảng lương /nhan-vien/bang-luong, chủ thương hiệu /chu-thuong-hieu. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`); host phải là localhost
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

    api.get('/payments/bank-qr/TUBU2026101900001', {
      orderCode: 'TUBU2026101900001', amount: 80_000, paymentStatus: 'UNPAID', paymentDeadline: null,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: 'TUBU2026101900001', qrString: 'x', qrImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    });

    await page.goto('/dai-ly');
    await expect(page.getByText('Hết hàng — được đặt trước')).toBeVisible();
    await page.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(page.getByText('Đặt trước 1, giao khi hàng về')).toBeVisible();
    await expect(page.getByText(/1 mặt hàng đặt vượt tồn/).filter({ visible: true }).first()).toBeVisible();

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
    await page.getByRole('button', { name: 'Báo đã chuyển khoản' }).click();
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
    await expect(page.getByText('Trang dành cho nhân viên', { exact: true })).toBeVisible();
    await expect(page.getByText('Tài khoản này chưa có quyền nhân viên. Liên hệ quản trị để được cấp quyền.')).toBeVisible();
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

test.describe('Web bảng lương', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('xem lương tháng và lưu tài khoản nhận lương bằng PUT /staff/bank', async ({ page, api }) => {
    mockStaff(api);
    const profile = { hourlyRate: 30000, bankBin: '970407', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };
    api.get('/staff/payroll', {
      month: { year: 2026, month: 3, totalMinutes: 270, gross: 135000, totalFines: 0, net: 135000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null },
      days: [],
      profile,
    });
    api.get('/staff/attendance/history', []);
    api.put('/staff/bank', profile);

    await page.goto('/nhan-vien/bang-luong');
    await expect(page.getByRole('heading', { name: 'Lương của tôi', level: 1 })).toBeVisible();
    await expect(page.getByText('Đã chốt')).toBeVisible();

    await page.getByRole('button', { name: 'Thông tin nhận lương' }).click();
    await page.getByLabel('Số tài khoản').fill(' 9876543210 ');
    const saved = api.waitForCall('PUT', '/staff/bank');
    await page.getByRole('button', { name: 'Lưu' }).click();
    const call = await saved;
    expect(call.body).toMatchObject({ bankBin: '970407', bankAccountNo: '9876543210', bankAccountName: 'NGUYEN VAN A' });
    await expect(page.getByText('Đã lưu thông tin nhận lương.')).toBeVisible();
  });
});

const OWNER_BRAND = {
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12,
  promotions: [{ id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true }],
};

function mockOwner(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', USER);
  api.get('/brand/owner/me', OWNER_BRAND);
  api.get('/config/public', {});
}

test.describe('Web chủ thương hiệu', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('chưa được cấp nhãn (404): báo rõ, không có nút thử lại', async ({ page, api }) => {
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me', USER);
    api.get('/config/public', {});
    api.get('/brand/owner/me', () => reply(404, { message: 'Not Found' }));
    await page.goto('/chu-thuong-hieu');
    await expect(page.getByRole('heading', { name: 'Quản lý nhãn hàng', level: 1 })).toBeVisible();
    await expect(page.getByText('Bạn chưa được cấp quyền quản lý nhãn nào.')).toBeVisible();
  });

  test('thêm khuyến mãi gắn mã gửi POST với mã viết hoa; mã bị từ chối thì hiện lỗi máy chủ', async ({ page, api }) => {
    mockOwner(api);
    api.post('/brand/owner/me/promotions', () => reply(400, { message: 'Mã giảm giá "MASAI" chưa có trong hệ thống.' }));
    await page.goto('/chu-thuong-hieu');
    await expect(page.getByText('Sachi', { exact: true })).toBeVisible();

    await page.getByLabel('Tiêu đề (MUA 2 TẶNG 1)').fill('Giảm sốc');
    await page.getByLabel('Mã giảm giá (tuỳ chọn) — VD: TUBU20').fill('masai');
    const sent = api.waitForCall('POST', '/brand/owner/me/promotions');
    await page.getByRole('button', { name: 'Thêm khuyến mãi' }).click();
    const call = await sent;
    expect(call.body).toMatchObject({ title: 'Giảm sốc', couponCode: 'MASAI' });
    await expect(page.getByRole('alert').filter({ hasText: 'chưa có trong hệ thống' })).toBeVisible();
  });

  test('tab Doanh thu: đổi kỳ gọi lại với kỳ mới', async ({ page, api }) => {
    mockOwner(api);
    api.get('/brand/owner/me/sales', {
      period: '30d', from: '2026-09-10T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z',
      orderCount: 12, unitsSold: 31, revenue: 4_560_000, delivered: { orderCount: 9, revenue: 3_200_000 },
      topProducts: [{ productId: 'p1', name: 'Nước rửa chén Sachi', slug: 'nrc', quantity: 20, revenue: 3_000_000 }],
    });
    await page.goto('/chu-thuong-hieu?tab=sales');
    await expect(page.getByText('4.560.000đ')).toBeVisible();
    const next = api.waitForCall('GET', '/brand/owner/me/sales');
    await page.getByRole('tab', { name: 'Tháng trước' }).click();
    expect((await next).query.get('period')).toBe('prev_month');
  });
});

test.describe('Web admin nhân sự và lương', () => {
  const ADMIN = { ...USER, role: 'ADMIN', fullName: 'Quản trị' };

  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: ADMIN }));
    api.get('/me', ADMIN);
    api.get('/config/public', {});
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  });

  test('cấp quyền ADMIN theo SĐT phải xác nhận rồi gửi POST /admin/staff/grant', async ({ page, api }) => {
    api.get('/admin/staff', { members: [], pendingInvites: [] });
    api.post('/admin/staff/grant', { granted: 'ADMIN', applied: false });
    await page.goto('/admin?tab=staffRoster');
    await page.getByPlaceholder('Số điện thoại (VD 09xxxxxxxx)').fill('0944444444');
    await page.getByRole('button', { name: 'Quản trị', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu quyền' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('cấp quyền ADMIN');
    const sent = api.waitForCall('POST', '/admin/staff/grant');
    await page.getByRole('button', { name: 'Cấp quyền ADMIN' }).click();
    expect((await sent).body).toEqual({ phone: '0944444444', role: 'ADMIN' });
    await expect(page.getByText('Đã lưu quyền (sẽ áp khi họ mở app).')).toBeVisible();
  });

  test('duyệt ca: từ chối bắt buộc lý do rồi gửi POST /admin/shifts/:id/reject', async ({ page, api }) => {
    const monday = new Date();
    const shift = {
      id: 'sh1', staffId: 's1', staff: { id: 's1', fullName: 'Lan', phone: '0911111111', avatarUrl: null },
      workDate: new Date(monday.toISOString().slice(0, 10)).toISOString(), startAt: monday.toISOString(), endAt: monday.toISOString(),
      templateId: null, status: 'PENDING', approvedStart: null, approvedEnd: null, rejectReason: null, cancelReason: null,
      isEmergency: false, evidenceUrl: null, cancelPenalty: false,
    };
    api.get('/admin/shifts', [shift]);
    api.post('/admin/shifts/:id/reject', { ...shift, status: 'REJECTED', rejectReason: 'Trùng lịch' });
    await page.goto('/admin?tab=shiftApproval');
    await page.getByRole('button', { name: /^Từ chối ca Lan/ }).click();
    const accept = page.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận từ chối' });
    await expect(accept).toBeDisabled();
    await page.getByRole('alertdialog').getByRole('textbox').fill('Trùng lịch');
    const sent = api.waitForCall('POST', '/admin/shifts/:id/reject');
    await accept.click();
    expect((await sent).body).toEqual({ reason: 'Trùng lịch' });
  });

  test('lương: chốt gửi year/month đang xem; mở lại có xác nhận', async ({ page, api }) => {
    const now = new Date();
    const month = {
      year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 500_000,
      status: 'OPEN', paidAt: null, proofImageUrl: null, note: null,
    };
    api.get('/admin/payroll', [
      { staff: { id: 's1', fullName: 'Lan', phone: '0911111111' }, month, profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: null, bankAccountName: null, qrImageUrl: null, active: true }, qrImageUrl: null },
    ]);
    api.post('/admin/payroll/:id/finalize', { finalized: true });
    await page.goto('/admin?tab=payroll');
    await expect(page.getByText('2h05')).toBeVisible();
    const sent = api.waitForCall('POST', '/admin/payroll/:id/finalize');
    await page.getByRole('button', { name: 'Chốt · Lan' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Chốt bảng lương?' });
    await expect(dialog).toContainText('Lan');
    await dialog.getByRole('button', { name: 'Chốt lương' }).click();
    expect((await sent).body).toEqual({ year: month.year, month: month.month });
  });
});
