import { mkdirSync } from 'fs';
import { join } from 'path';
import { test, expect, type MockApi } from './support/mock-api';
import type { Page } from '@playwright/test';

/**
 * Admin, thẻ Sự thật xanh ở khổ điện thoại (360 và 375 px): chọn sản phẩm + phân loại bằng ô tìm (không gõ slug/SKU), tạo nháp từ danh sách
 * Refill, duyệt hàng loạt các dòng Nháp đủ điều kiện. Mọi lệnh gọi /api/ được giả; spec không đụng DB và không đổi cờ nào.
 * Đặt ECO_SHOT_DIR để lưu ảnh chụp từng bước.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const T = (n: number) => `2026-11-28T0${n}:00:00.000Z`;
const fact = (over: Record<string, unknown>) => ({
  id: 'f1',
  productId: 'p1',
  productName: 'Refill Nước giặt Bạc hà Fuwa3e 10L',
  productSlug: 'refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f',
  variationId: null,
  variationName: null,
  variationSku: null,
  kind: 'REFILL_PACK',
  valueGrams: null,
  baselineText: null,
  label: null,
  co2Grams: null,
  sourceUrl: 'https://tubutree.com/phieu-can/refill-10l',
  sourceKind: 'internal_sheet',
  sourceNote: 'Phiếu cân dòng 3',
  status: 'DRAFT',
  approvedById: null,
  approvedAt: null,
  updatedAt: T(1),
  blockers: [],
  ...over,
});

const WAITING = [
  { code: 'value_grams', message: 'Giảm nhựa cần số gam lớn hơn 0.' },
  { code: 'source_url', message: 'Thiếu link nguồn https.' },
  { code: 'source_note', message: 'Thiếu ghi chú nguồn (trang, bảng số).' },
];

const ITEMS = [
  fact({ id: 'a', updatedAt: T(1) }),
  fact({ id: 'b', productName: 'Refill Nước rửa chén Fuwa3e 10L', productSlug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244', kind: 'PLASTIC_AVOIDED', valueGrams: 640, baselineText: 'so với 20 chai 500ml', updatedAt: T(2) }),
  fact({ id: 'c', productName: 'Refill Lau đa năng Fuwa3e 10L', productSlug: 'refill-lau-da-nang-fuwa3e-10l-a08433', updatedAt: T(3) }),
  fact({ id: 'd', productName: 'Refill Nước lau sàn Quế Fuwa3e 10L', productSlug: 'refill-nuoc-lau-san-que-fuwa3e-10l-fe82e8', kind: 'PLASTIC_AVOIDED', sourceUrl: '', sourceKind: null, sourceNote: '', blockers: WAITING, updatedAt: T(4) }),
];

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Refill Nước giặt Bạc hà Fuwa3e 10L',
    slug: 'refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f',
    brand: 'Fuwa3e',
    thumbnail: null,
    isActive: true,
    variations: [
      { id: 'v5', name: 'Can 5L', sku: 'RF-NG-5L', price: 520_000, stock: 4, isActive: true },
      { id: 'v10', name: 'Can 10L', sku: 'RF-NG-10L', price: 990_000, stock: 9, isActive: true },
    ],
  },
];

function mockAdmin(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/products/search', PRODUCTS);
}

async function shot(page: Page, name: string) {
  const dir = process.env.ECO_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** Trang không được rộng hơn khung nhìn: thanh cuộn ngang ở 360 px là lỗi bố cục. */
async function expectNoHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

/** Mọi ô chọn, nút trong vùng cần chạm phải cao ≥ 44 px (chuẩn chạm Mini App/web). */
async function expectTouchTargets(page: Page, selector: string) {
  const heights = await page.locator(selector).evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
}

for (const width of [360, 375]) {
  test.describe(`Admin: Sự thật xanh ở ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test.beforeEach(async ({ page, api }) => {
      await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
      mockAdmin(api);
    });

    test('duyệt hàng loạt: chỉ dòng đủ điều kiện có ô chọn, xác nhận nêu cờ, gửi đúng id + updatedAt', async ({ page, api }) => {
      let drafts = ITEMS;
      api.get('/admin/eco-facts', () => ({ items: drafts }));
      api.post('/admin/eco-facts/approve-batch', () => {
        drafts = drafts.filter((d) => !['a', 'b', 'c'].includes(d.id));
        return { approved: ['a', 'b', 'c'], skipped: [] };
      });

      await page.goto('/admin/su-that-xanh');
      const bar = page.getByTestId('eco-batch-bar');
      await expect(bar).toContainText('Chọn tất cả đủ điều kiện (3)');
      const rows = page.getByTestId('eco-fact-row');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(3)).toContainText('Chờ cân');
      await expect(rows.nth(3)).toContainText('Chưa duyệt được');
      await expect(rows.nth(3).getByRole('checkbox')).toHaveCount(0);
      await expect(rows.nth(0)).toContainText('Phiếu cân nội bộ');
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page, '[data-testid="eco-batch-bar"] label, [data-testid="eco-batch-bar"] button, [data-testid="eco-fact-row"] label');
      await shot(page, `${width}-1-list`);

      await bar.getByRole('checkbox').check();
      await expect(bar.getByRole('button', { name: 'Duyệt 3 dòng đã chọn' })).toBeEnabled();
      await shot(page, `${width}-2-selected`);

      await bar.getByRole('button', { name: 'Duyệt 3 dòng đã chọn' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('Duyệt 3 sự thật?');
      await expect(dialog).toContainText('eco.product_badges_enabled');
      await expectNoHorizontalScroll(page);
      await shot(page, `${width}-3-confirm`);

      const call = api.waitForCall('POST', '/admin/eco-facts/approve-batch');
      await dialog.getByRole('button', { name: 'Duyệt 3 dòng' }).click();
      expect((await call).body).toEqual({
        items: [
          { id: 'a', expectedUpdatedAt: T(1) },
          { id: 'b', expectedUpdatedAt: T(2) },
          { id: 'c', expectedUpdatedAt: T(3) },
        ],
      });
      await expect(page.locator('[data-admin-toast]').filter({ hasText: 'Đã duyệt 3 dòng.' })).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(page.getByTestId('eco-batch-bar')).toHaveCount(0);
      await shot(page, `${width}-4-after`);
      expect(api.callsTo('POST', '/admin/eco-facts/approve-batch')).toHaveLength(1);
      expect(api.callsTo('PUT', '/admin/config')).toHaveLength(0);
    });

    test('form thêm: ô tìm sản phẩm + chọn phân loại thay cho gõ slug/SKU, lưu gửi đúng slug và SKU', async ({ page, api }) => {
      api.get('/admin/eco-facts', () => ({ items: [] }));
      api.post('/admin/eco-facts', () => fact({ id: 'new', variationId: 'v5', variationName: 'Can 5L', variationSku: 'RF-NG-5L' }));

      await page.goto('/admin/su-that-xanh');
      await page.getByRole('button', { name: 'Thêm sự thật' }).click();
      const form = page.getByTestId('eco-fact-form');
      await expect(form).toBeVisible();
      await expect(form).not.toContainText('Slug sản phẩm');
      await expect(form).not.toContainText('SKU phân loại');
      const variation = form.locator('select').filter({ hasText: 'Cả sản phẩm' });
      await expect(variation).toBeDisabled();

      await form.getByRole('searchbox', { name: /Tìm sản phẩm/ }).fill('refill nuoc giat');
      const option = form.getByRole('option').first();
      await expect(option).toContainText('Refill Nước giặt Bạc hà Fuwa3e 10L');
      await expectNoHorizontalScroll(page);
      await shot(page, `${width}-5-picker-results`);
      await option.click();
      await expect(variation).toBeEnabled();
      await variation.selectOption('RF-NG-5L');
      await form.locator('input[type="url"]').fill('https://tubutree.com/phieu-can/refill-5l');
      await form.locator('input[maxlength="300"]').fill('Phiếu cân dòng 3');
      await expectNoHorizontalScroll(page);
      await shot(page, `${width}-6-form-filled`);

      const call = api.waitForCall('POST', '/admin/eco-facts');
      await form.getByRole('button', { name: 'Lưu nháp' }).click();
      expect((await call).body).toMatchObject({
        productSlug: 'refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f',
        variationSku: 'RF-NG-5L',
        kind: 'REFILL_PACK',
        sourceUrl: 'https://tubutree.com/phieu-can/refill-5l',
      });
      await expect(page.locator('[data-admin-toast]').filter({ hasText: 'Đã lưu bản nháp.' })).toBeVisible();
    });

    test('Tạo nháp từ danh sách Refill: gập sẵn, gửi link phiếu cân nội bộ, báo kết quả', async ({ page, api }) => {
      api.get('/admin/eco-facts', () => ({ items: [] }));
      api.post('/admin/eco-facts/refill-drafts', () => ({ refillProducts: 11, created: 22, skippedExisting: 0 }));

      await page.goto('/admin/su-that-xanh');
      const panel = page.getByTestId('eco-refill-drafts');
      await expect(panel.locator('input[type="url"]')).toBeHidden();
      await panel.getByText('Tạo nháp từ danh sách Refill').click();
      await panel.locator('input[type="url"]').fill('https://tubutree.com/phieu-can/refill-10l');
      await expectNoHorizontalScroll(page);
      await shot(page, `${width}-7-refill-drafts`);

      const call = api.waitForCall('POST', '/admin/eco-facts/refill-drafts');
      await panel.getByRole('button', { name: 'Tạo nháp' }).click();
      expect((await call).body).toEqual({ sheetUrl: 'https://tubutree.com/phieu-can/refill-10l', sourceNote: null });
      await expect(panel).toContainText('Tạo 22 nháp từ 11 gói Refill');
      await expectNoHorizontalScroll(page);
      await shot(page, `${width}-8-refill-result`);
    });
  });
}
