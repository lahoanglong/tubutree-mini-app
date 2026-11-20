import { test, expect, reply, type MockApi } from './support/mock-api';

// Khớp `AdminRefillPairs` của apps/web/src/components/admin/refill-pairs/api.ts (tệp đó nhập alias `@/lib` mà tsconfig e2e không giải được).
interface AdminRefillProduct {
  id: string;
  slug: string;
  name: string;
  sizeLabel: string | null;
}
interface AdminRefillPairRow {
  bottle: AdminRefillProduct;
  refill: AdminRefillProduct | null;
  status: 'auto' | 'manual' | 'size' | 'ambiguous' | 'near' | 'blocked';
  candidates: number;
  ratio: number | null;
}
interface AdminRefillPairs {
  enabled: boolean;
  maxRatio: number;
  rows: AdminRefillPairRow[];
  overrides: { bottleSlug: string; refillSlug: string }[];
  block: { slug: string; name: string | null }[];
  choices: { bottles: AdminRefillProduct[]; refills: AdminRefillProduct[] };
}

/**
 * Admin, thẻ Cặp Refill: nút "Duyệt nhanh tất cả gợi ý (N)" mở khung xem trước đúng các cặp `near`, "Duyệt N cặp" gửi MỘT lần PUT
 * `confirm[]` rồi bảng mới thay bảng cũ; máy chủ trả 409 (bảng vừa đổi ở nơi khác) thì báo lỗi, đóng khung và đọc lại bảng.
 * Mọi lệnh gọi /api/ được giả.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const product = (slug: string, name: string, sizeLabel: string): AdminRefillProduct => ({ id: `id-${slug}`, slug, name, sizeLabel });

const CHEN = product('nuoc-rua-chen-500ml', 'Nước rửa chén 500ml', '500ml');
const CHEN_REFILL = product('refill-nuoc-rua-chen-10l', 'Refill nước rửa chén 10L', '10L');
const SAN = product('nuoc-lau-san-1l', 'Nước lau sàn 1L', '1L');
const SAN_REFILL = product('refill-nuoc-lau-san-10l', 'Refill nước lau sàn 10L', '10L');
const TAY = product('nuoc-rua-tay-300ml', 'Nước rửa tay 300ml', '300ml');
const TAY_REFILL = product('refill-nuoc-rua-tay-5l', 'Refill nước rửa tay 5L', '5L');

const pairRow = (bottle: AdminRefillProduct, refill: AdminRefillProduct, status: AdminRefillPairRow['status']): AdminRefillPairRow => ({
  bottle,
  refill,
  status,
  candidates: 1,
  ratio: 20,
});

function table(status: { chen: AdminRefillPairRow['status']; san: AdminRefillPairRow['status'] }): AdminRefillPairs {
  const manual = [
    ...(status.chen === 'manual' ? [{ bottleSlug: CHEN.slug, refillSlug: CHEN_REFILL.slug }] : []),
    ...(status.san === 'manual' ? [{ bottleSlug: SAN.slug, refillSlug: SAN_REFILL.slug }] : []),
  ];
  return {
    enabled: true,
    maxRatio: 25,
    rows: [pairRow(CHEN, CHEN_REFILL, status.chen), pairRow(SAN, SAN_REFILL, status.san), pairRow(TAY, TAY_REFILL, 'auto')],
    overrides: manual,
    block: [],
    choices: { bottles: [CHEN, SAN, TAY], refills: [CHEN_REFILL, SAN_REFILL, TAY_REFILL] },
  };
}

function mockAdmin(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', { generatedAt: '2026-11-21T03:00:00.000Z', items: [] });
  api.get('/admin/ops/health', { generatedAt: '2026-11-21T03:00:00.000Z', problems: [], cronJobs: [] });
  api.get('/admin/dashboard/today', { orders: { today: 0, yesterday: 0, week: 0 }, revenue: { today: 0, yesterday: 0, week: 0 }, newUsers: { today: 0, yesterday: 0, week: 0 } });
  api.get('/admin/analytics/retention-daily', []);
}

test.describe('Admin: Cặp Refill, duyệt nhanh các cặp tên gần giống', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
  });

  test('xem trước đúng 2 cặp near, một lần PUT confirm[], bảng mới thay bảng cũ và focus về tiêu đề thẻ', async ({ page, api }) => {
    mockAdmin(api);
    let current = table({ chen: 'near', san: 'near' });
    api.get('/admin/refill-pairs', () => current);
    api.put('/admin/refill-pairs', () => {
      current = table({ chen: 'manual', san: 'manual' });
      return current;
    });

    await page.goto('/admin?tab=refillPairs');
    const open = page.getByRole('button', { name: 'Duyệt nhanh tất cả gợi ý (2)' });
    await expect(open).toBeVisible();
    await open.click();

    const preview = page.getByTestId('refill-confirm-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Duyệt 2 cặp tên gần giống' })).toBeFocused();
    const items = preview.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(CHEN.name);
    await expect(items.nth(0)).toContainText(CHEN_REFILL.name);
    await expect(items.nth(1)).toContainText(SAN.name);
    await expect(items.nth(1)).toContainText(SAN_REFILL.name);
    await expect(preview).not.toContainText(TAY.name);

    const put = api.waitForCall('PUT', '/admin/refill-pairs');
    await preview.getByRole('button', { name: 'Duyệt 2 cặp' }).click();
    const call = await put;
    expect(call.body).toEqual({
      confirm: [
        { bottleSlug: CHEN.slug, refillSlug: CHEN_REFILL.slug },
        { bottleSlug: SAN.slug, refillSlug: SAN_REFILL.slug },
      ],
    });

    await expect(page.getByRole('status').filter({ hasText: 'Đã duyệt 2 cặp gợi ý.' })).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(page.getByRole('button', { name: /Duyệt nhanh tất cả gợi ý/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Cặp Refill', level: 2 })).toBeFocused();
    expect(api.callsTo('PUT', '/admin/refill-pairs')).toHaveLength(1);
  });

  test('máy chủ trả 409: báo lỗi, đóng khung xem trước, đọc lại bảng; không có lần ghi thứ hai', async ({ page, api }) => {
    mockAdmin(api);
    let current = table({ chen: 'near', san: 'near' });
    api.get('/admin/refill-pairs', () => current);
    api.put('/admin/refill-pairs', () => {
      // Admin khác vừa ghép tay chai lau sàn: bảng đổi, máy chủ không ghi cặp nào.
      current = table({ chen: 'near', san: 'manual' });
      return reply(409, { statusCode: 409, error: 'Conflict', message: 'Cặp Nước lau sàn 1L không còn là gợi ý, chưa cặp nào được duyệt. Tải lại thẻ Cặp Refill rồi duyệt lại.' });
    });

    await page.goto('/admin?tab=refillPairs');
    await page.getByRole('button', { name: 'Duyệt nhanh tất cả gợi ý (2)' }).click();
    const preview = page.getByTestId('refill-confirm-preview');
    const reload = api.waitForCall('GET', '/admin/refill-pairs');
    await preview.getByRole('button', { name: 'Duyệt 2 cặp' }).click();

    // Lọc theo chữ: Next có sẵn một role="alert" rỗng (__next-route-announcer__).
    await expect(page.getByRole('alert').filter({ hasText: 'chưa cặp nào được duyệt' })).toBeVisible();
    await expect(preview).toBeHidden();
    await reload;
    await expect(page.getByRole('button', { name: 'Duyệt nhanh tất cả gợi ý (1)' })).toBeVisible();
    expect(api.callsTo('PUT', '/admin/refill-pairs')).toHaveLength(1);
  });
});
