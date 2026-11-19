import { test, expect, type MockApi } from './support/mock-api';
import type { AdminWasteRequestRowDTO, WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
import type { AdminOrder, OrderOpsCounts, Page } from '../../web/src/lib/admin-client';
import type { Page as PwPage } from '@playwright/test';

/**
 * Admin — bàn vận hành w7-03: ô KPI lọc nhanh đầu tab Đơn hàng (khách vãng lai web, chờ chuyển khoản, tự huỷ quá hạn CK) và
 * chip cách giao / trạng thái + nút một chạm ở bảng yêu cầu đổi rác. Mock mọi lệnh gọi /api, không cần API/DB.
 * Chạy ở 375 px (điện thoại) và 1280 px: trang không được tràn ngang ở cả hai khổ.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const VIEWPORTS = [
  { width: 1280, height: 900, tag: '1280' },
  { width: 375, height: 812, tag: '375' },
] as const;

/** Phiên admin giả — cùng cơ chế `mockAdminSession` của admin.spec.ts (không import chéo giữa các file test). */
function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
}

const page = <T,>(data: T[]): Page<T> => ({ data, meta: { page: 1, limit: 20, total: data.length } });

const COUNTS: OrderOpsCounts = { guestWeb: 7, guestWebUnmerged: 3, bankTransferPending: 4, bankTransferOverdue: 2, overdueCancelled: 5, ttlHours: 24 };

const GUEST_ORDER: AdminOrder = {
  id: 'o1',
  code: 'TT-20261119-WEB1',
  status: 'PENDING_PAYMENT',
  type: 'RETAIL',
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  subtotal: 250_000,
  discount: 0,
  shippingFee: 0,
  total: 250_000,
  createdAt: '2026-11-18T01:00:00.000Z',
  user: { id: 'g1', phone: null, fullName: null },
  guestPhone: '0977000111',
  guestSource: 'guest',
  paymentDeadline: '2026-11-19T01:00:00.000Z',
  items: [],
};

const OVERDUE_ORDER: AdminOrder = {
  ...GUEST_ORDER,
  id: 'o2',
  code: 'TT-20261117-WEB2',
  status: 'CANCELLED',
  guestSource: 'merged',
  paymentDeadline: null,
  cancellation: { at: '2026-11-18T02:05:00.000Z', note: 'Tự động hủy do quá hạn chuyển khoản 24h', actorType: 'SYSTEM', overdue: true },
};

const noHorizontalOverflow = (p: PwPage) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Ảnh chỉ chụp khi đặt W703_SHOT_DIR, để chạy CI không ghi file ra ngoài thư mục test. */
async function shot(p: PwPage, name: string) {
  const dir = process.env.W703_SHOT_DIR;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.describe('Admin — bàn vận hành đơn (w7-03)', () => {
  for (const vp of VIEWPORTS) {
    test(`ô KPI đầu tab Đơn hàng lọc nhanh và giữ trên link, dòng đơn hiện nguồn khách + hạn CK + lý do huỷ (${vp.tag} px)`, async ({ page: p, api }) => {
      mockAdminSession(api);
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await p.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
      api.get('/admin/orders/status-counts', { all: 2, byStatus: { PENDING_PAYMENT: 1, CANCELLED: 1 } });
      api.get('/admin/orders/ops-counts', COUNTS);
      api.get('/admin/orders', page([GUEST_ORDER, OVERDUE_ORDER]));

      await p.goto('/admin?tab=orders');
      const strip = p.getByRole('group', { name: 'Lọc nhanh vận hành đơn' });
      await expect(strip).toBeVisible({ timeout: 15_000 });
      await expect(strip.locator('[data-ops-tile="guest"]')).toContainText('7');
      await expect(strip.locator('[data-ops-tile="guest"]')).toContainText('3 chưa gộp Zalo');
      await expect(strip.locator('[data-ops-tile="bankPending"]')).toContainText('2 quá hạn');
      await expect(strip.locator('[data-ops-tile="overdueCancelled"]')).toContainText('Tự huỷ quá hạn CK 24h');
      await expect(p.getByText('Vãng lai', { exact: true }).first()).toBeVisible();
      await expect(p.getByText('Đã gộp Zalo', { exact: true }).first()).toBeVisible();
      // Bảng có bản sao md:hidden cho khổ hẹp trong ô mã đơn: chỉ đếm bản đang hiện.
      await expect(p.locator('[data-cancellation]:visible')).toContainText(['Tự huỷ quá hạn CK · nhả kho 09:05 18/11/2026Tự động hủy do quá hạn chuyển khoản 24h']);
      await expect(p.locator('[data-payment-deadline]:visible').first()).toContainText('CK');
      expect(await noHorizontalOverflow(p)).toBeLessThanOrEqual(0);
      await shot(p, `orders-${vp.tag}`);

      await strip.locator('[data-ops-tile="overdueCancelled"]').click();
      await expect(strip.locator('[data-ops-tile="overdueCancelled"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(p).toHaveURL(/status=CANCELLED&queue=bank_transfer_overdue_cancelled/);
      await expect.poll(() => api.callsTo('GET', '/admin/orders').at(-1)?.query.get('queue')).toBe('bank_transfer_overdue_cancelled');
      await strip.locator('[data-ops-tile="guest"]').click();
      await expect(p).toHaveURL(/guest=web/);
      await expect.poll(() => api.callsTo('GET', '/admin/orders/ops-counts').at(-1)?.query.get('guest')).toBe('web');
    });
  }
});

const ROW: AdminWasteRequestRowDTO = {
  id: 'wr-1',
  code: 'TR-7K3M9Q',
  method: 'DROP_OFF',
  status: 'RECEIVED',
  closeReason: null,
  createdAt: '2026-11-18T02:00:00.000Z',
  expiresAt: null,
  inTransitAt: null,
  receivedAt: '2026-11-18T03:00:00.000Z',
  completedAt: null,
  estimatedPoints: 20_000,
  pointsAwarded: null,
  pointId: 'pt-hcm',
  pointName: 'Kho Tubu HCM',
  customerName: 'N** V** A',
  customerPhone: '090****567',
  carrier: null,
  trackingCode: null,
  trackingConflict: false,
  orderCode: null,
  waitingReason: null,
};

const PICK_ROW: AdminWasteRequestRowDTO = { ...ROW, id: 'wr-2', code: 'TR-PICK22', method: 'PICKUP', status: 'OPEN', receivedAt: null, orderCode: 'TT-20261117-AB12' };

const DETAIL = {
  id: 'wr-1',
  code: 'TR-7K3M9Q',
  method: 'DROP_OFF',
  status: 'RECEIVED',
  point: { id: 'pt-hcm', name: 'Kho Tubu HCM', kind: 'WAREHOUSE' },
  lines: [
    { itemId: 'i1', itemName: 'Thùng carton cũ', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, gramsPerUnit: null, declaredQty: 20, receivedQty: null, shortfallReason: null, pointsAwarded: null, hazardous: false },
  ],
} as unknown as WasteRequestAdminDetailDTO;

test.describe('Admin — bảng yêu cầu đổi rác: lọc nhanh và nút một chạm (w7-03)', () => {
  for (const vp of VIEWPORTS) {
    test(`chip theo luồng đang bật, tra SĐT, Nhận kiện và Cộng điểm có hỏi lại (${vp.tag} px)`, async ({ page: p, api }) => {
      mockAdminSession(api);
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await p.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
      api.get('/config/public', { waste: { enabled: true, dropoff: true, mailin: false, pickup: true } });
      api.allowUnmocked('GET /admin/waste/overview');
      api.get('/admin/waste/items', []);
      api.get('/admin/waste/points', []);
      api.get('/admin/waste/unmatched', []);
      api.get('/admin/waste/gifts', []);
      api.get('/admin/waste/gift-redemptions', []);
      api.get('/admin/waste/requests/lookup', [PICK_ROW]);
      api.get('/admin/waste/requests/:id', DETAIL);
      api.get('/admin/waste/requests', { rows: [ROW, PICK_ROW], nextCursor: null });
      api.post('/admin/waste/requests/:id/receive', { outcome: 'RECEIVED', requestId: 'wr-2', receivedAt: '2026-11-19T02:05:00.000Z' });
      api.post('/admin/waste/requests/:id/confirm', { requestId: 'wr-1', code: 'TR-7K3M9Q', status: 'COMPLETED', pointsAwarded: 20_000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 5 });

      await p.goto('/admin?tab=waste');
      const quick = p.getByRole('group', { name: 'Lọc theo cách giao và trạng thái' });
      await expect(quick).toBeVisible({ timeout: 15_000 });
      await expect(quick.getByRole('button')).toHaveText(['Mang tới kho HCM', 'Tài xế lấy kèm đơn', 'Chờ tiếp nhận', 'Đã nhận', 'Đã cộng điểm']);
      expect(await noHorizontalOverflow(p)).toBeLessThanOrEqual(0);
      await shot(p, `waste-${vp.tag}`);

      await quick.getByRole('button', { name: 'Chờ tiếp nhận', exact: true }).click();
      await expect.poll(() => api.callsTo('GET', '/admin/waste/requests').at(-1)?.query.get('filter')).toBe('AWAITING_RECEIPT');

      const lookup = p.getByRole('textbox', { name: 'Mã yêu cầu, SĐT khách, mã đơn hoặc mã vận đơn' });
      await expect(lookup).toHaveAttribute('maxlength', '64');
      await lookup.fill('0901234567');
      await p.getByRole('button', { name: 'Tra', exact: true }).click();
      const pick = p.locator('[data-lookup-results] [data-request="wr-2"]');
      await expect(pick).toBeVisible();
      await pick.locator('[data-quick="receive"]').click();
      const dialog = p.getByRole('alertdialog');
      await expect(dialog).toContainText('TT-20261117-AB12');
      await dialog.locator('[data-confirm="accept"]').click();
      await expect(p.getByText('Đã nhận TR-PICK22 lúc 09:05.')).toBeVisible();
      expect(api.callsTo('POST', '/admin/waste/requests/:id/receive')).toHaveLength(1);

      await p.locator('[data-request="wr-1"] [data-quick="count"]').first().click();
      await expect(dialog).toContainText('Cộng 20.000 điểm theo đúng số khách khai: 20 thùng Thùng carton cũ');
      await dialog.locator('[data-confirm="accept"]').click();
      await expect(p.getByText('Đã cộng 20.000 điểm cho TR-7K3M9Q.')).toBeVisible();
      const sent = api.callsTo('POST', '/admin/waste/requests/:id/confirm');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toEqual({ lines: [{ itemId: 'i1', declaredQty: 20, receivedQty: 20 }] });
      expect(await noHorizontalOverflow(p)).toBeLessThanOrEqual(0);
    });
  }
});
