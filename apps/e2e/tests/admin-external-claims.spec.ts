import { test, expect, type MockApi } from './support/mock-api';
import type { AdminExternalAttemptRow, AdminExternalClaimRow } from '../../web/src/lib/admin-client';

/**
 * Web Admin — tab "Tích điểm đơn sàn" (external-claims-tab.tsx): duyệt claim REVIEW và khối "người khác cùng gửi".
 *
 * Mock đúng dạng API thật (external-claims-admin.controller): GET /admin/external-claims và
 * GET /admin/external-claims/attempts trả `{ data, meta }`; POST /admin/external-claims/:id/approve trả `{ id, state }`.
 * Tab luôn gọi cả hai danh sách (AttemptsSection render cùng tab), nên mọi test đều phải mock cả hai.
 *
 * Mở thẳng `/admin?tab=externalClaims` (readUrlState trong app/admin/page.tsx đọc `?tab=`); tab mặc định lọc REVIEW.
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
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  // GET /admin/config?category= trả object {khoá: giá trị}; băng "tính năng đang tắt" đọc cờ từ đây.
  api.get('/admin/config', { 'loyalty.marketplace_claim_enabled': true });
}

function claim(over: Partial<AdminExternalClaimRow> & Pick<AdminExternalClaimRow, 'id' | 'maskedCode'>): AdminExternalClaimRow {
  return {
    externalOrderId: 'ext-1',
    pancakeOrderId: '90001',
    channel: null,
    source: 'CHAT',
    userId: 'user-1',
    userName: 'Trần Văn Bình',
    userPhoneMasked: '090****567',
    orderPhoneMasked: '090****567',
    goodsValue: 250_000,
    points: 250,
    kind: 'PHONE',
    state: 'REVIEW',
    holdUntil: null,
    orderStatus: 'DELIVERED',
    reviewReason: null,
    voidReason: null,
    decidedById: null,
    deliveredAt: null,
    creditedAt: null,
    createdAt: '2026-10-05T00:04:00.000Z',
    memberPhoneVerifiedAt: '2026-10-01T00:00:00.000Z',
    memberPhoneStale: false,
    memberCreatedAt: '2026-01-01T00:00:00.000Z',
    memberDeliveredAppOrders: 2,
    ...over,
  };
}

function attempt(over: Partial<AdminExternalAttemptRow> & Pick<AdminExternalAttemptRow, 'id' | 'maskedCode'>): AdminExternalAttemptRow {
  return {
    userId: 'user-9',
    userName: 'Lê Thị Cúc',
    userPhoneMasked: '098****321',
    result: 'NOT_FOUND',
    externalOrderId: null,
    note: null,
    createdAt: '2026-10-05T00:04:00.000Z',
    ...over,
  };
}

/** GET /admin/external-claims: bỏ các dòng đã duyệt (lọc theo trạng thái như API thật) và trả `{ data, meta }`. */
function mockClaimLists(api: MockApi, opts: { claims: () => AdminExternalClaimRow[]; attempts?: AdminExternalAttemptRow[] }) {
  api.get('/admin/external-claims', ({ call }) => {
    const state = call.query.get('state');
    const rows = opts.claims().filter((c) => !state || c.state === state);
    return { data: rows, meta: { page: 1, limit: 20, total: rows.length } };
  });
  const attempts = opts.attempts ?? [];
  api.get('/admin/external-claims/attempts', { data: attempts, meta: { page: 1, limit: 20, total: attempts.length } });
}

test.describe('Web Admin - Tích điểm đơn sàn', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    // Cờ `tubu_web_session` là thứ auth-context.tsx nhìn để quyết định gọi /auth/refresh; đặt trước script của trang.
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('Duyệt claim SĐT xác minh cũ: bắt ghi chú, gửi { note }, danh sách tải lại', async ({ page: p, api }) => {
    let approved = false;
    const stale = claim({
      id: 'claim-stale',
      maskedCode: 'VN12****89',
      reviewReason: 'SĐT xác minh đã cũ',
      memberPhoneVerifiedAt: '2026-01-01T00:00:00.000Z',
      memberPhoneStale: true,
    });
    mockClaimLists(api, { claims: () => (approved ? [] : [stale]) });
    api.post('/admin/external-claims/:id/approve', () => {
      approved = true;
      return { id: 'claim-stale', state: 'PENDING' };
    });

    await p.goto('/admin?tab=externalClaims');

    const row = p.locator('[data-external-claim="claim-stale"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('SĐT xác minh đã cũ, kiểm người nhận')).toBeVisible();
    const listCallsBefore = api.callsTo('GET', '/admin/external-claims').length;

    // Tab bar có nút "Duyệt SP đối tác": chỉ bấm nút trong dòng claim.
    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const dialog = p.getByRole('alertdialog', { name: 'Duyệt yêu cầu: SĐT xác minh đã cũ' });
    await expect(dialog).toBeVisible();
    const accept = dialog.getByRole('button', { name: 'Duyệt', exact: true });
    await expect(accept).toBeDisabled();

    // Khoảng trắng không tính: "a b" chỉ có 2 ký tự thật.
    const note = dialog.getByLabel(/Ghi chú \(đã xác nhận người nhận/);
    await note.fill('  a b  ');
    await expect(dialog.getByText('Ghi chú cần ít nhất 3 ký tự')).toBeVisible();
    await expect(accept).toBeDisabled();
    expect(api.callsTo('POST', '/admin/external-claims/:id/approve')).toHaveLength(0);

    await note.fill('Đã gọi xác nhận đúng người nhận');
    await expect(accept).toBeEnabled();
    const approveCall = api.waitForCall('POST', '/admin/external-claims/:id/approve');
    await accept.click();
    const call = await approveCall;
    expect(call.path).toBe('/admin/external-claims/claim-stale/approve');
    expect(call.body).toEqual({ note: 'Đã gọi xác nhận đúng người nhận' });

    await expect(p.getByText('Không có yêu cầu nào khớp.')).toBeVisible();
    expect(api.callsTo('GET', '/admin/external-claims').length).toBeGreaterThan(listCallsBefore);
  });

  test('Duyệt claim SĐT xác minh còn mới: hộp xác nhận thường, không gửi body', async ({ page: p, api }) => {
    let approved = false;
    const fresh = claim({ id: 'claim-fresh', maskedCode: 'VN55****01', reviewReason: 'Đơn vượt ngưỡng' });
    mockClaimLists(api, { claims: () => (approved ? [] : [fresh]) });
    api.post('/admin/external-claims/:id/approve', () => {
      approved = true;
      return { id: 'claim-fresh', state: 'PENDING' };
    });

    await p.goto('/admin?tab=externalClaims');

    const row = p.locator('[data-external-claim="claim-fresh"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('SĐT xác minh đã cũ, kiểm người nhận')).toHaveCount(0);

    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const dialog = p.getByRole('alertdialog', { name: 'Duyệt yêu cầu tích điểm' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);

    const approveCall = api.waitForCall('POST', '/admin/external-claims/:id/approve');
    await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const call = await approveCall;
    expect(call.path).toBe('/admin/external-claims/claim-fresh/approve');
    expect(call.body).toBeUndefined();

    await expect(p.getByText('Không có yêu cầu nào khớp.')).toBeVisible();
  });

  test('Lần gửi mã có người khác cùng gửi: hiện số người và danh sách; không có thì không có khối', async ({ page: p, api }) => {
    mockClaimLists(api, {
      claims: () => [],
      attempts: [
        attempt({
          id: 'att-shared',
          maskedCode: 'VN77****42',
          otherSubmittersCount: 2,
          otherSubmitters: [
            { userId: 'user-a', userName: 'Phạm Minh Dũng', userPhoneMasked: '091****111', createdAt: '2026-10-05T00:04:00.000Z' },
            { userId: 'user-b', userName: null, userPhoneMasked: null, createdAt: '2026-10-04T16:30:00.000Z' },
          ],
        }),
        attempt({ id: 'att-alone', maskedCode: 'VN88****43', otherSubmittersCount: 0, otherSubmitters: [] }),
        attempt({ id: 'att-legacy', maskedCode: 'VN99****44' }),
      ],
    });

    await p.goto('/admin?tab=externalClaims');

    const shared = p.locator('[data-external-attempt="att-shared"]');
    await expect(shared).toBeVisible({ timeout: 15_000 });
    const block = shared.locator('[data-other-submitters]');
    await expect(block.getByText('2 người khác cùng gửi mã này')).toBeVisible();
    // createdAt UTC được đổi sang giờ VN (UTC+7): 00:04Z → 07:04, 16:30Z hôm trước → 23:30.
    await expect(block.getByText('Phạm Minh Dũng · 091****111 · gửi lúc 07:04 05/10/2026')).toBeVisible();
    await expect(block.getByText('— · không có SĐT · gửi lúc 23:30 04/10/2026')).toBeVisible();

    await expect(p.locator('[data-external-attempt="att-alone"]')).toBeVisible();
    await expect(p.locator('[data-external-attempt="att-legacy"]')).toBeVisible();
    await expect(p.locator('[data-external-attempt="att-alone"] [data-other-submitters]')).toHaveCount(0);
    await expect(p.locator('[data-external-attempt="att-legacy"] [data-other-submitters]')).toHaveCount(0);
    await expect(p.locator('[data-other-submitters]')).toHaveCount(1);
  });
});
