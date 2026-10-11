import { test, expect, reply, type MockApi, type MockContext } from './support/mock-api';
import type { AdminCustomerRefund, Page } from '../../web/src/lib/admin-client';

/**
 * Admin — tab "Hoàn tiền khách" (Q-01 / PA-1): hàng đợi chuyển khoản tay cho khách cuối của đơn CTV lên hộ.
 *
 * Mock đúng dạng API thật (customer-refunds-admin.controller.ts): GET /admin/customer-refunds trả `paginated()`
 * = `{ data, meta }`, POST /admin/customer-refunds/:id/mark-paid trả dòng đã COMPLETED hoặc 400 khi khoản không
 * còn PENDING (thua race giữa hai admin). Trang không bao giờ tự chuyển tiền: UI chỉ ghi sổ việc admin đã chuyển.
 *
 * Mở thẳng `/admin?tab=customerRefunds` (readUrlState trong app/admin/page.tsx đọc `?tab=`).
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: {
    id: 'admin-1',
    role: 'ADMIN',
    fullName: 'Test Admin',
    avatarUrl: null,
    pointsBalance: 0,
    walletBalance: 0,
    referralCode: 'ADMIN1',
  },
};

/** Phiên admin giả — cùng cơ chế `mockAdminSession` của admin.spec.ts (không import chéo giữa các file test). */
function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 0,
    itemCount: 0,
  });
}

function refund(over: Partial<AdminCustomerRefund> & Pick<AdminCustomerRefund, 'id'>): AdminCustomerRefund {
  return {
    orderId: `order-${over.id}`,
    orderCode: `TT-20261001-${over.id}`,
    amount: 1_250_000,
    phone: '0912345678',
    recipientName: 'Trần Thị B',
    customerUserId: null,
    method: 'MANUAL_TRANSFER',
    status: 'PENDING',
    reason: 'CANCELLED',
    completedAt: null,
    completedBy: null,
    bankRef: null,
    adminNote: null,
    createdAt: '2026-10-01T03:00:00.000Z',
    ...over,
  };
}

function page<T>(data: T[], p: number, limit: number, total: number): Page<T> {
  return { data, meta: { page: p, limit, total } };
}

/** GET /admin/customer-refunds đọc `state.rows` hiện tại: đổi được sau khi mark-paid để kiểm tải lại danh sách. */
function mockList(api: MockApi, state: { rows: AdminCustomerRefund[] }) {
  api.get('/admin/customer-refunds', ({ call }: MockContext) => {
    const status = call.query.get('status');
    const limit = Number(call.query.get('limit') ?? 20);
    const pg = Number(call.query.get('page') ?? 1);
    const rows = state.rows.filter((r) => !status || r.status === status);
    return page(rows.slice((pg - 1) * limit, pg * limit), pg, limit, rows.length);
  });
}

const MARK_PAID = '/admin/customer-refunds/:id/mark-paid';

test.describe('Admin — Hoàn tiền khách (đơn CTV lên hộ)', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('hàng chờ: hiện khoản chuyển khoản tay (tên, SĐT, số tiền, lý do), huy hiệu số khoản trên tab; dòng ví không có nút', async ({ page: p, api }) => {
    const state = {
      rows: [
        refund({ id: 'r1' }),
        refund({ id: 'r2', reason: 'RETURNED', amount: 480_000, recipientName: 'Lê Văn C', phone: '0987654321' }),
        refund({ id: 'r3', method: 'WALLET', status: 'COMPLETED', customerUserId: 'user-9' }),
      ],
    };
    mockList(api, state);

    await p.goto('/admin?tab=customerRefunds');

    const r1 = p.locator('[data-refund-id="r1"]');
    await expect(r1).toBeVisible({ timeout: 15_000 });
    await expect(r1).toContainText('1.250.000đ');
    await expect(r1).toContainText('Trần Thị B');
    await expect(r1).toContainText('0912345678');
    await expect(r1).toContainText('Đơn bị huỷ');
    await expect(p.locator('[data-refund-id="r2"]')).toContainText('Đơn trả hàng');
    await expect(r1.getByRole('button', { name: 'Đã chuyển khoản', exact: true })).toBeVisible();

    // Mặc định lọc PENDING; dòng WALLET (COMPLETED) không nằm trong hàng chờ.
    await expect(p.locator('[data-refund-id="r3"]')).toHaveCount(0);
    const list = api.callsTo('GET', '/admin/customer-refunds');
    expect(list.some((c) => c.query.get('status') === 'PENDING' && c.query.get('limit') === '20')).toBe(true);

    // Huy hiệu: một lần gọi limit=1 lấy meta.total (2 khoản PENDING).
    expect(list.some((c) => c.query.get('status') === 'PENDING' && c.query.get('limit') === '1')).toBe(true);
    await expect(p.getByRole('button', { name: /^Hoàn tiền khách/ })).toContainText('2');

    // Dòng ví chỉ là dòng vết (tiền đã vào ví khách lúc huỷ/trả): hiện "Đã hoàn vào ví", không có nút hành động.
    await p.getByRole('tab', { name: 'Đã chuyển', exact: true }).click();
    const wallet = p.locator('[data-refund-id="r3"]');
    await expect(wallet).toContainText('Đã hoàn vào ví');
    await expect(wallet.getByRole('button', { name: 'Đã chuyển khoản', exact: true })).toHaveCount(0);
  });

  test('Đã chuyển khoản: hộp xác nhận nêu số tiền/tên/SĐT, gửi mark-paid đúng body, danh sách và huy hiệu cập nhật', async ({ page: p, api }) => {
    const state = { rows: [refund({ id: 'r1' })] };
    mockList(api, state);
    api.post(MARK_PAID, ({ params, call }) => {
      const row = state.rows.find((r) => r.id === params.id)!;
      const body = call.body as { bankRef?: string; note?: string };
      Object.assign(row, {
        status: 'COMPLETED',
        completedAt: '2026-10-02T08:30:00.000Z',
        completedBy: 'admin-1',
        bankRef: body.bankRef ?? null,
        adminNote: body.note ?? null,
      });
      return row;
    });

    await p.goto('/admin?tab=customerRefunds');
    await p.locator('[data-refund-id="r1"]').getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();

    const dialog = p.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1.250.000đ');
    await expect(dialog).toContainText('Trần Thị B');
    await expect(dialog).toContainText('0912345678');
    await expect(dialog).toContainText('không tự chuyển tiền');
    // Mở hộp chưa gửi gì.
    expect(api.callsTo('POST', MARK_PAID)).toHaveLength(0);

    await dialog.getByLabel('Mã giao dịch ngân hàng (tuỳ chọn)').fill('FT26275123456');
    await dialog.getByLabel('Ghi chú (tuỳ chọn)').fill('Chuyển VCB 15h');
    const paid = api.waitForCall('POST', MARK_PAID);
    await dialog.getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
    const call = await paid;
    expect(call.path).toBe('/admin/customer-refunds/r1/mark-paid');
    expect(call.body).toEqual({ bankRef: 'FT26275123456', note: 'Chuyển VCB 15h' });

    await expect(dialog).toHaveCount(0);
    await expect(p.getByText(/Đã ghi nhận chuyển khoản 1\.250\.000đ/)).toBeVisible();
    await expect(p.getByText('Không có khoản hoàn nào đang chờ chuyển khoản.')).toBeVisible();
    await expect(p.locator('[data-refund-id="r1"]')).toHaveCount(0);
    await expect(p.getByRole('button', { name: /^Hoàn tiền khách/ })).not.toContainText('1');
    expect(api.callsTo('POST', MARK_PAID)).toHaveLength(1);

    // Bộ lọc "Đã chuyển": dòng vừa ghi hiện mã tham chiếu + ghi chú và không còn nút hành động.
    await p.getByRole('tab', { name: 'Đã chuyển', exact: true }).click();
    const done = p.locator('[data-refund-id="r1"]');
    await expect(done).toContainText('FT26275123456');
    await expect(done).toContainText('Chuyển VCB 15h');
    await expect(done.getByRole('button', { name: 'Đã chuyển khoản', exact: true })).toHaveCount(0);
    expect(api.callsTo('GET', '/admin/customer-refunds').some((c) => c.query.get('status') === 'COMPLETED')).toBe(true);
  });

  test('Huỷ hộp xác nhận: đóng hộp, không gọi mark-paid, khoản vẫn chờ chuyển khoản', async ({ page: p, api }) => {
    mockList(api, { rows: [refund({ id: 'r1' })] });

    await p.goto('/admin?tab=customerRefunds');
    await p.locator('[data-refund-id="r1"]').getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
    const dialog = p.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(p.locator('[data-refund-id="r1"]').getByRole('button', { name: 'Đã chuyển khoản', exact: true })).toBeVisible();
    expect(api.callsTo('POST', MARK_PAID)).toHaveLength(0);
  });

  test('thua race (400 không còn chờ chuyển khoản): hiện thông báo của API, đóng hộp, tải lại danh sách', async ({ page: p, api }) => {
    const state = { rows: [refund({ id: 'r1' })] };
    mockList(api, state);
    const STALE = 'Khoản hoàn không còn chờ chuyển khoản.';
    api.post(MARK_PAID, () => {
      // Admin khác vừa xử lý xong khoản này.
      state.rows[0]!.status = 'COMPLETED';
      return reply(400, { statusCode: 400, message: STALE });
    });

    await p.goto('/admin?tab=customerRefunds');
    await p.locator('[data-refund-id="r1"]').getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
    const dialog = p.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(p.getByRole('alert').filter({ hasText: STALE })).toBeVisible();
    await expect(p.locator('[data-refund-id="r1"]')).toHaveCount(0);
    await expect(p.getByText(/Đã ghi nhận chuyển khoản/)).toHaveCount(0);
  });

  test('lỗi máy chủ 500: giữ hộp, báo thử lại bằng tiếng Việt; bấm lại thành công thì mới đóng', async ({ page: p, api }) => {
    const state = { rows: [refund({ id: 'r1' })] };
    mockList(api, state);
    let fail = true;
    api.post(MARK_PAID, () => {
      if (fail) return reply(500, { statusCode: 500, message: 'Internal server error' });
      state.rows[0]!.status = 'COMPLETED';
      return state.rows[0];
    });

    await p.goto('/admin?tab=customerRefunds');
    await p.locator('[data-refund-id="r1"]').getByRole('button', { name: 'Đã chuyển khoản', exact: true }).click();
    const dialog = p.getByRole('alertdialog');
    await dialog.getByLabel('Mã giao dịch ngân hàng (tuỳ chọn)').fill('FT1');
    const accept = dialog.getByRole('button', { name: 'Đã chuyển khoản', exact: true });
    await accept.click();

    await expect(dialog.getByRole('alert')).toContainText('Máy chủ');
    await expect(dialog.getByRole('alert')).not.toContainText('Internal server error');
    await expect(dialog).toBeVisible();
    await expect(accept).toBeEnabled();
    await expect(dialog.getByLabel('Mã giao dịch ngân hàng (tuỳ chọn)')).toHaveValue('FT1');

    fail = false;
    await accept.click();
    await expect(dialog).toHaveCount(0);
    await expect(p.locator('[data-refund-id="r1"]')).toHaveCount(0);
    expect(api.callsTo('POST', MARK_PAID)).toHaveLength(2);
  });

  test('điện thoại 390px: màn Hoàn tiền khách không tràn ngang', async ({ page: p, api }) => {
    mockList(api, {
      rows: [
        refund({
          id: 'r1',
          recipientName: 'Nguyễn Thị Một Cái Tên Rất Dài Để Thử Ngắt Dòng',
          orderCode: 'TT-20261001-MA-DON-RAT-DAI-0000000000000001',
        }),
      ],
    });
    await p.setViewportSize({ width: 390, height: 844 });

    await p.goto('/admin?tab=customerRefunds');
    await expect(p.locator('[data-refund-id="r1"]')).toBeVisible({ timeout: 15_000 });

    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
