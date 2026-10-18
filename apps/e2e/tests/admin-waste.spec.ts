import { test, expect, type MockApi } from './support/mock-api';
import type {
  AdminGiftRedemptionRowDTO,
  AdminWastePointDTO,
  AdminWasteRequestRowDTO,
  WasteMonthMetrics,
  WasteOverviewDTO,
  WasteRequestAdminDetailDTO,
  WasteReverseResultDTO,
} from '@tubutree/shared-types';

/**
 * Admin — tab "Đổi rác lấy quà": dải số liệu tháng, thu hồi điểm (bắt buộc lý do), huỷ quà READY (chọn hoàn điểm tường minh).
 * Mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB. Mở thẳng `/admin?tab=waste`.
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

/** Phiên admin giả — cùng cơ chế `mockAdminSession` của admin-customer-refunds.spec.ts (không import chéo giữa các file test). */
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

const EMPTY_METRICS: WasteMonthMetrics = {
  requestsCreatedByMethod: { DROP_OFF: 0, MAIL_IN: 0, PICKUP: 0 },
  requestsByStatus: { OPEN: 0, IN_TRANSIT: 0, RECEIVED: 0, COMPLETED: 0, REJECTED: 0, CANCELLED: 0, EXPIRED: 0, REVERSED: 0 },
  completeHoursP50: null,
  completeHoursP90: null,
  unitsByItem: [],
  unitsByPoint: [],
  pointsIssued: 0,
  pointsReversed: 0,
  receivedDeclaredPctByMethod: { DROP_OFF: null, MAIL_IN: null, PICKUP: null },
  receivedDeclaredPctByPoint: [],
  rejectionsByReason: {
    WET: 0, DIRTY: 0, FOREIGN_OBJECT: 0, WRONG_TYPE: 0, DAMAGED: 0, NOT_ACCEPTED: 0, OVERSIZE: 0, HAZARDOUS: 0, UNPAID_POSTAGE: 0, OTHER: 0,
  },
  expiredCount: 0,
  quotaByPoint: [],
  pickupCount: 0,
  carrierCostVnd: 0,
  receivedWeightGrams: null,
  estimatedWeightGrams: null,
  repeatCustomers60d: 0,
  ordersOfExchangers: 0,
  ordersOfNonExchangers: 0,
  costVndPer1000PointsIssued: null,
};

const EMPTY_OVERVIEW: WasteOverviewDTO = {
  month: '2026-10',
  previousMonth: '2026-09',
  alerts: [],
  current: { ...EMPTY_METRICS, pointsIssued: 120_000, pointsReversed: 6_000 },
  previous: EMPTY_METRICS,
};

const REQUEST_ROW: AdminWasteRequestRowDTO = {
  id: 'wr-c-1',
  code: 'TR-C0MPL',
  method: 'DROP_OFF',
  status: 'COMPLETED',
  closeReason: null,
  createdAt: '2026-10-10T03:00:00.000Z',
  expiresAt: null,
  inTransitAt: null,
  receivedAt: null,
  completedAt: '2026-10-12T04:00:00.000Z',
  estimatedPoints: 0,
  pointsAwarded: 20_000,
  pointId: '',
  pointName: '',
  customerName: '',
  customerPhone: null,
  carrier: null,
  trackingCode: null,
  trackingConflict: false,
  orderCode: null,
  waitingReason: null,
};

const REQUEST_DETAIL: WasteRequestAdminDetailDTO = {
  ...REQUEST_ROW,
  lines: [],
  point: null,
  pointAvailable: false,
  completedAt: null,
  closedAt: null,
  rejectionReason: null,
  rejectionNote: null,
  dropsAwarded: null,
  impactGrams: null,
  reversedPoints: null,
  reversalReason: null,
  editable: false,
  cancellable: false,
  orderId: null,
  confirmedByUserId: null,
  receivedWeightGrams: null,
  carrierCostVnd: null,
  reversedAt: null,
  reversedByUserId: null,
  reversalShortfallPoints: null,
  capDayKey: '',
  capMonthKey: '',
  consentAt: '2026-10-10T03:00:00.000Z',
  consentVersion: '',
};

const GIFT_ROW: AdminGiftRedemptionRowDTO = {
  id: 'gr-r-1',
  giftId: 'gift-cup',
  giftKind: 'GIFT',
  giftName: 'Cốc tre Tubu',
  pointsCost: 30_000,
  status: 'READY',
  codeLast2: '7Q',
  code: 'QG-ABCD7Q7Q',
  customerName: 'Nguyễn Văn A',
  customerPhone: '0901234567',
  userId: 'u-1',
  claimExpiresAt: '2026-12-16T16:59:59.000Z',
  overdue: false,
  createdAt: '2026-10-17T03:00:00.000Z',
};

test.describe('Admin — Đổi rác lấy quà', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/config', []);
    api.get('/admin/waste/overview', EMPTY_OVERVIEW);
    api.get('/admin/waste/items', []);
    api.get('/admin/waste/points', []);
    api.get('/admin/waste/unmatched', []);
    api.get('/admin/waste/gifts', []);
    api.get('/admin/waste/requests', { rows: [], nextCursor: null });
    api.get('/admin/waste/gift-redemptions', []);
  });

  test('tab Đổi rác mở được, dải tháng đọc từ overview', async ({ page }) => {
    await page.goto('/admin?tab=waste');

    await expect(page.getByRole('heading', { name: 'Đổi rác lấy quà', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-month-strip]')).toContainText('120.000');
    await page.getByText('Xem báo cáo tháng', { exact: true }).click();
    await expect(page.locator('[data-metric="pointsIssued"]')).toContainText('120.000');
    const chipTop = (await page.getByRole('group', { name: 'Mục đổi rác' }).boundingBox())!.y;
    expect(chipTop).toBeLessThan(700);
  });

  test('thu hồi điểm: nút Thu hồi chỉ bật khi đã nhập lý do, gửi đúng body', async ({ page, api }) => {
    api.get('/admin/waste/requests', { rows: [REQUEST_ROW], nextCursor: null });
    api.get('/admin/waste/requests/wr-c-1', { ...REQUEST_DETAIL, status: 'COMPLETED' });
    const result: WasteReverseResultDTO = { requestId: 'wr-c-1', status: 'REVERSED', pointsTaken: 20_000, shortfallPoints: 0 };
    const reversed = api.waitForCall('POST', '/admin/waste/requests/wr-c-1/reverse');
    api.post('/admin/waste/requests/wr-c-1/reverse', result);

    await page.goto('/admin?tab=waste');
    await page.getByRole('button', { name: 'Yêu cầu', exact: true }).click();
    const row = page.locator('[data-request="wr-c-1"]');
    await expect(row).toContainText('TR-C0MPL', { timeout: 15_000 });
    await row.getByRole('button', { name: 'Mở', exact: true }).click();
    await page.getByRole('button', { name: 'Thu hồi điểm', exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Thu hồi', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Lý do').fill('Khách khai gian');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const call = await reversed;
    expect(call.body).toEqual({ reason: 'Khách khai gian' });
    await expect(page.getByText('Đã thu hồi 20.000 điểm.')).toBeVisible();
  });

  test('huỷ quà READY bắt chọn có hoàn điểm hay không', async ({ page, api }) => {
    api.get('/admin/waste/gift-redemptions', [GIFT_ROW]);
    api.post('/admin/waste/gift-redemptions/gr-r-1/cancel', { ...GIFT_ROW, status: 'CANCELLED' });

    await page.goto('/admin?tab=waste');
    await page.getByRole('button', { name: 'Quà', exact: true }).click();
    const item = page.locator('[data-redemption="gr-r-1"]');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.getByRole('button', { name: 'Huỷ', exact: true }).click();

    const confirm = item.getByRole('button', { name: 'Xác nhận huỷ', exact: true });
    await expect(item.locator('input[name="refundPoints"]:checked')).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await item.getByRole('textbox').fill('Khách bị khoá');
    await expect(confirm).toBeDisabled();

    await item.locator('input[name="refundPoints"][value="true"]').check();
    await expect(item.getByLabel('Hoàn điểm cho khách')).toBeChecked();
    const cancelled = api.waitForCall('POST', '/admin/waste/gift-redemptions/gr-r-1/cancel');
    await confirm.click();
    const call = await cancelled;
    expect(call.body).toEqual({ reason: 'Khách bị khoá', refundPoints: true });
  });

  test('không tràn ngang ở 1280 px', async ({ page }) => {
    await page.goto('/admin?tab=waste');
    await expect(page.locator('[data-month-strip]')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Xem báo cáo tháng', { exact: true }).click();
    await expect(page.locator('[data-metric="pointsIssued"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('bảng điểm nhận: nút Chi tiết và Sửa của hàng đầu nằm trong màn hình 1280 px', async ({ page, api }) => {
    const hours = [{ open: '08:00', close: '20:00' }];
    const point: AdminWastePointDTO = {
      id: 'wp-e2e', kind: 'PARTNER', name: 'Tạp hoá Cô Ba', addressLine: '12 Lê Lợi', provinceCode: '79', provinceName: 'TP. Hồ Chí Minh',
      communeCode: '26734', communeName: 'Phường Bến Thành', lat: null, lng: null, phone: null,
      openingHours: { MON: hours, TUE: hours, WED: hours, THU: hours, FRI: hours, SAT: [{ open: '08:00', close: '12:00' }] },
      acceptedItemIds: [], perkText: null, quotaFull: false, distanceKm: null, status: 'ACTIVE', monthlyQuotaPoints: 100_000,
      monthUsage: { monthKey: '2026-10', pointsUsed: 82_000, confirmations: 41 }, perkPendingText: 'Tặng một túi vải cho khách đổi trên 5 thùng',
      giftHandoverEnabled: false, note: null, sortOrder: 10, activatedAt: null, lastConfirmedAt: null, hiddenInactive: true, staff: [],
    };
    api.get('/admin/waste/points', [point]);
    await page.goto('/admin?tab=waste');
    await expect(page.locator('[data-month-strip]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Điểm nhận', exact: true }).click();
    const row = page.locator('[data-point="wp-e2e"]');
    await expect(row).toContainText('Tạp hoá Cô Ba');
    const region = await page.getByRole('region', { name: 'Bảng điểm nhận' }).boundingBox();
    expect(region).not.toBeNull();
    for (const name of ['Sửa', 'Chi tiết', 'Kích hoạt lại']) {
      const box = await row.getByRole('button', { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(region!.x + region!.width);
    }
  });
});
