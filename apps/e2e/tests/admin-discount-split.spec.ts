import fs from 'fs';
import path from 'path';
import { test, expect, type MockApi } from './support/mock-api';
import type { AdminOrder, DealerCreditLedger, Page } from '../../web/src/lib/admin-client';
import type { Locator, Page as PwPage } from '@playwright/test';

/**
 * Admin — tách chiết khấu thương mại (ghi trên hoá đơn) khỏi chiết khấu thanh toán (ghi lúc thu tiền), W154.
 *
 * Hai màn cùng nằm trong chi tiết một đơn ĐẠI LÝ ở tab Đơn hàng: khối "Hoá đơn bán hàng" (OrderInvoiceBreakdown, chỉ khi canFinance)
 * và bảng đối chiếu thu tiền `[data-payment-settlement]` trong "Công nợ đại lý". Mock mọi lệnh gọi /api, không cần API/DB.
 * Điện thoại (dưới 768px) mở chi tiết trong ngăn kéo thay vì chen vào bảng, nên spec chạy cả hai khổ.
 *
 * W156: đơn lẻ CŨ (bốn cột giảm chi tiết đều 0) có dùng Điểm Xanh phải tách tiền điểm khỏi chiết khấu thương mại trên khối hoá đơn.
 *
 * Ảnh chỉ chụp khi đặt W154_SHOT_DIR, để chạy CI không ghi file ra ngoài thư mục test.
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

const VIEWPORTS = [
  { width: 1280, height: 800, tag: '1280' },
  { width: 360, height: 800, tag: '360' },
] as const;

const ORDER_CODE = 'TT-20261114-DL01';
const DEALER_ID = 'dealer-1';

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
}

/** Đơn đại lý: tiền hàng 100.000đ theo đơn giá gốc, chiết khấu thương mại 20.000đ, phải thu 80.000đ, không phí giao. */
function dealerOrder(): AdminOrder {
  return {
    id: 'o1',
    code: ORDER_CODE,
    status: 'CONFIRMED',
    type: 'DEALER',
    dealerOnCredit: true,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    subtotal: 100_000,
    discount: 20_000,
    tierDiscount: 20_000,
    shippingFee: 0,
    total: 80_000,
    createdAt: '2026-11-14T03:00:00.000Z',
    user: { id: DEALER_ID, phone: '0901234567', fullName: 'Đại lý Cô Lan' },
    items: [{ id: 'i1', productName: 'Nước rửa chén Tubu', variationName: '1L', unitPrice: 100_000, quantity: 1, total: 100_000 }],
  };
}

function page<T>(data: T[]): Page<T> {
  return { data, meta: { page: 1, limit: 20, total: data.length } };
}

/** Sổ công nợ đang nợ đúng 100.000đ: bảng đối chiếu tính phải thu theo dư nợ sổ, không theo tổng của một đơn. */
const LEDGER: DealerCreditLedger = {
  balance: 100_000,
  entries: [{ id: 'e1', delta: 100_000, refType: 'ORDER', refId: 'o1', note: `Đơn ${ORDER_CODE} ghi công nợ`, createdAt: '2026-11-14T03:00:00.000Z' }],
};

/**
 * Đơn lẻ CŨ: tạo trước khi API lưu từng khoản giảm nên cả bốn cột (coupon/combo/tier/points) bằng 0, chỉ có tổng `discount` 30.000đ.
 * Khách đã dùng 10.000 Điểm Xanh (1 điểm = 1đ) nên 10.000đ là tiền điểm và chỉ 20.000đ là chiết khấu thương mại (voucher).
 */
const LEGACY_ORDER_CODE = 'TT-20260901-LE01';
function legacyRetailOrder(): AdminOrder {
  return {
    id: 'o2',
    code: LEGACY_ORDER_CODE,
    status: 'CONFIRMED',
    type: 'RETAIL',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    subtotal: 100_000,
    discount: 30_000,
    couponDiscount: 0,
    comboDiscount: 0,
    tierDiscount: 0,
    pointsDiscount: 0,
    pointsUsed: 10_000,
    shippingFee: 0,
    total: 70_000,
    createdAt: '2026-09-01T03:00:00.000Z',
    user: { id: 'user-2', phone: '0907654321', fullName: 'Khách Lẻ Cũ' },
    items: [{ id: 'i2', productName: 'Nước rửa chén Tubu', variationName: '1L', unitPrice: 100_000, quantity: 1, total: 100_000 }],
  };
}

function mockOrdersTab(api: MockApi, order: AdminOrder = dealerOrder()) {
  api.get('/admin/orders', page([order]));
  api.get('/admin/orders/status-counts', { all: 1, byStatus: { CONFIRMED: 1 } });
  api.get('/admin/dealers/:id/credit-ledger', LEDGER);
}

/** Máy tính mở dòng đơn trong bảng, điện thoại mở thẻ đơn thành ngăn kéo. */
async function openOrderDetail(p: PwPage, narrow: boolean, code: string = ORDER_CODE) {
  await p.goto('/admin?tab=orders');
  if (narrow) {
    await p.getByRole('button', { name: new RegExp(code) }).click();
    await expect(p.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  } else {
    await p.getByRole('button', { name: 'Xem & Sửa', exact: true }).click({ timeout: 15_000 });
  }
}

/** Lề phải của khối phải nằm trong khung nhìn: ngăn kéo điện thoại cuộn riêng nên scrollWidth của trang không bắt được tràn bên trong nó. */
async function expectNoHorizontalOverflow(p: PwPage, section: Locator) {
  const pageOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(pageOverflow).toBeLessThanOrEqual(0);
  const box = await section.boundingBox();
  const innerWidth = await p.evaluate(() => window.innerWidth);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
}

async function shot(p: PwPage, section: Locator, fileName: string) {
  const dir = process.env.W154_SHOT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await section.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: path.join(dir, fileName), animations: 'disabled' });
}

/** Dòng `<dt>` rồi `<dd>` kề nó trong bảng đối chiếu. */
const settlementValue = (settlement: Locator, label: string | RegExp) =>
  settlement.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');

test.describe('Admin — chiết khấu thương mại và chiết khấu thanh toán tách riêng (đơn đại lý)', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    mockOrdersTab(api);
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  for (const vp of VIEWPORTS) {
    test(`hoá đơn ${vp.tag}px: tiền hàng đủ 100.000đ, chiết khấu thương mại -20.000đ là dòng giảm riêng, tổng 80.000đ, không tràn ngang`, async ({ page: p }) => {
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await openOrderDetail(p, vp.width < 768);

      const invoice = p.getByRole('region', { name: 'Hoá đơn bán hàng', exact: true });
      await expect(invoice).toBeVisible({ timeout: 15_000 });
      await expect(invoice.locator('[data-invoice-row=goods] dd')).toHaveText('100.000đ');
      await expect(invoice.locator('[data-invoice-row=trade] dd')).toHaveText('-20.000đ');
      await expect(invoice.locator('[data-invoice-row=total] dd')).toHaveText('80.000đ');
      // Không phí giao, không điểm: hai dòng đó không được dựng thừa.
      await expect(invoice.locator('[data-invoice-row=ship]')).toHaveCount(0);
      await expect(invoice.locator('[data-invoice-row=points]')).toHaveCount(0);
      // Chiết khấu thanh toán không bao giờ là dòng giảm của hoá đơn.
      await expect(invoice.locator('[data-invoice-row]')).toHaveCount(3);
      // Đơn giá dòng hàng giữ nguyên 100.000đ dù đã có chiết khấu.
      await expect(p.getByText('1 x 100.000đ')).toBeVisible();

      await expectNoHorizontalOverflow(p, invoice);
      await shot(p, invoice, `tubu-w154-invoice-trade-discount-${vp.tag}.png`);
    });

    test(`thu tiền ${vp.tag}px: thực thu 80.000đ + CK thanh toán 20.000đ xoá hết nợ 100.000đ, hoá đơn không đổi, không tràn ngang`, async ({ page: p, api }) => {
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await openOrderDetail(p, vp.width < 768);

      const credit = p.getByRole('region', { name: 'Công nợ đại lý', exact: true });
      await credit.getByRole('button', { name: 'Công nợ đại lý', exact: true }).click({ timeout: 15_000 });
      await expect(credit.getByText('Dư nợ hiện tại:')).toContainText('100.000đ');

      await credit.getByLabel('Số tiền đã nhận (đ)', { exact: true }).fill('80000');
      await credit.getByLabel('CK thanh toán (đ, tuỳ chọn)', { exact: true }).fill('20000');

      const settlement = credit.locator('[data-payment-settlement]');
      await expect(settlement).toBeVisible();
      await expect(settlementValue(settlement, 'Phải thu hoá đơn')).toHaveText('100.000đ');
      await expect(settlementValue(settlement, 'Thực thu tiền')).toHaveText('80.000đ');
      await expect(settlementValue(settlement, /^CK thanh toán/)).toHaveText('20.000đ');
      await expect(settlementValue(settlement, 'Công nợ còn lại')).toHaveText('0đ');
      // Đã xoá hết phần còn lại thì không gợi ý "Xoá nợ phần còn lại" nữa.
      await expect(settlement.getByRole('button', { name: /Xoá nợ phần còn lại/ })).toHaveCount(0);

      await expectNoHorizontalOverflow(p, settlement);
      await shot(p, settlement, `tubu-w154-settlement-payment-discount-${vp.tag}.png`);

      // Chỉ xem trước: không bấm "Xác nhận đã nhận" nên sổ không bị ghi.
      expect(api.callsTo('POST', '/admin/dealers/:id/credit-payment')).toHaveLength(0);
    });
  }
});

test.describe('Admin — hoá đơn đơn lẻ CŨ có dùng Điểm Xanh (W156)', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    mockOrdersTab(api, legacyRetailOrder());
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  for (const vp of VIEWPORTS) {
    test(`hoá đơn ${vp.tag}px: tiền hàng 100.000đ, CK thương mại chỉ -20.000đ, Điểm Xanh -10.000đ là dòng riêng, tổng 70.000đ, không tràn ngang`, async ({ page: p }) => {
      await p.setViewportSize({ width: vp.width, height: vp.height });
      await openOrderDetail(p, vp.width < 768, LEGACY_ORDER_CODE);

      const invoice = p.getByRole('region', { name: 'Hoá đơn bán hàng', exact: true });
      await expect(invoice).toBeVisible({ timeout: 15_000 });
      await expect(invoice.locator('[data-invoice-row=goods] dd')).toHaveText('100.000đ');
      await expect(invoice.locator('[data-invoice-row=trade] dd')).toHaveText('-20.000đ');
      await expect(invoice.locator('[data-invoice-row=points] dd')).toHaveText('-10.000đ');
      await expect(invoice.locator('[data-invoice-row=total] dd')).toHaveText('70.000đ');
      await expect(invoice.locator('[data-invoice-row=ship]')).toHaveCount(0);
      await expect(invoice.locator('[data-invoice-row]')).toHaveCount(4);

      await expectNoHorizontalOverflow(p, invoice);
      await shot(p, invoice, `tubu-w156-invoice-legacy-points-${vp.tag}.png`);
    });
  }
});
