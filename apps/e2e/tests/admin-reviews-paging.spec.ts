import { test, expect, type MockApi } from './support/mock-api';

/**
 * Admin, tab Đánh giá: ẩn đánh giá cuối của trang cuối khi đang lọc "Đang hiện" làm danh sách co lại một trang. Trang đang xem
 * rỗng mà các trang trước còn đánh giá: phải về trang cuối còn dữ liệu, không báo "Không có đánh giá nào khớp bộ lọc."
 * Máy chủ giả lọc và cắt trang thật theo `page`, `limit`, `visibility`; mọi lệnh gọi /api/ được giả.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const PAGE_SIZE = 20;

type Row = { id: string; isVisible: boolean };

function seed(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i + 1}`, isVisible: true }));
}

function body(r: Row, order: number) {
  return {
    id: r.id,
    rating: 5,
    comment: `Nhận xét ${r.id}`,
    images: [],
    videoUrl: null,
    isVisible: r.isVisible,
    isVerified: true,
    createdAt: new Date(Date.UTC(2026, 10, 1) - order * 60_000).toISOString(),
    user: { id: `u-${r.id}`, fullName: `Khách ${r.id}`, phone: null },
    product: { id: 'p1', name: 'Nước rửa chén', slug: 'nuoc-rua-chen' },
  };
}

function mockAdmin(api: MockApi, rows: Row[]) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', { generatedAt: '2026-11-01T03:00:00.000Z', items: [] });
  api.get('/admin/ops/health', { generatedAt: '2026-11-01T03:00:00.000Z', problems: [], cronJobs: [] });
  api.get('/admin/dashboard/today', { orders: { today: 5, yesterday: 3, week: 20 }, revenue: { today: 1500000, yesterday: 2000000, week: 9000000 }, newUsers: { today: 2, yesterday: 2, week: 11 } });
  api.get('/admin/analytics/retention-daily', []);
  api.get('/admin/reviews', ({ call }) => {
    const page = Number(call.query.get('page') ?? 1);
    const limit = Number(call.query.get('limit') ?? PAGE_SIZE);
    const visibility = call.query.get('visibility');
    const matching = rows.filter((r) => (visibility === 'visible' ? r.isVisible : visibility === 'hidden' ? !r.isVisible : true));
    const slice = matching.slice((page - 1) * limit, page * limit);
    return { data: slice.map((r) => body(r, rows.indexOf(r))), meta: { page, limit, total: matching.length } };
  });
  api.post('/reviews/:id/visibility', ({ params, call }) => {
    const row = rows.find((r) => r.id === params.id)!;
    row.isVisible = (call.body as { isVisible: boolean }).isVisible;
    return { ok: true, isVisible: row.isVisible };
  });
}

test.describe('Admin: duyệt đánh giá khi danh sách co lại một trang', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  async function hideFirstOnPage(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Ẩn đánh giá' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ẩn đánh giá' }).click();
  }

  test('21 đánh giá đang hiện: ẩn dòng duy nhất của trang 2 thì về trang 1 và vẫn thấy 20 đánh giá', async ({ page, api }) => {
    mockAdmin(api, seed(PAGE_SIZE + 1));
    await page.goto('/admin?tab=reviews');
    await page.getByRole('tab', { name: 'Đang hiện' }).click();
    await expect(page.getByText('21 đánh giá · Trang 1/2')).toBeVisible();
    await page.getByRole('button', { name: 'Sau' }).click();
    await expect(page.getByText('Nhận xét r21')).toBeVisible();
    await expect(page.getByText('Nhận xét r1', { exact: true })).toHaveCount(0);

    await hideFirstOnPage(page);

    await expect(page.getByText('20 đánh giá', { exact: true })).toBeVisible();
    await expect(page.getByText('Nhận xét r1', { exact: true })).toBeVisible();
    await expect(page.getByText('Nhận xét r20', { exact: true })).toBeVisible();
    await expect(page.getByText('Không có đánh giá nào khớp bộ lọc.')).toHaveCount(0);
    await expect(page.getByText('Đang tải đánh giá…')).toHaveCount(0);
    const pages = api.callsTo('GET', '/admin/reviews').map((c) => c.query.get('page'));
    expect(pages.at(-1)).toBe('1');
  });

  test('41 đánh giá đang hiện, đang ở trang 3: ẩn dòng duy nhất thì về trang 2 (trang cuối còn dữ liệu), không nhảy về trang 1', async ({ page, api }) => {
    mockAdmin(api, seed(PAGE_SIZE * 2 + 1));
    await page.goto('/admin?tab=reviews');
    await page.getByRole('tab', { name: 'Đang hiện' }).click();
    await page.getByRole('button', { name: 'Sau' }).click();
    await page.getByRole('button', { name: 'Sau' }).click();
    await expect(page.getByText('41 đánh giá · Trang 3/3')).toBeVisible();
    await expect(page.getByText('Nhận xét r41')).toBeVisible();

    await hideFirstOnPage(page);

    await expect(page.getByText('40 đánh giá · Trang 2/2')).toBeVisible();
    await expect(page.getByText('Nhận xét r21', { exact: true })).toBeVisible();
    await expect(page.getByText('Không có đánh giá nào khớp bộ lọc.')).toHaveCount(0);
  });

  test('ẩn đánh giá duy nhất còn hiện: báo rỗng và không nhảy sang trang nào khác trang 1', async ({ page, api }) => {
    mockAdmin(api, seed(1));
    await page.goto('/admin?tab=reviews');
    await page.getByRole('tab', { name: 'Đang hiện' }).click();
    await expect(page.getByText('Nhận xét r1', { exact: true })).toBeVisible();

    await hideFirstOnPage(page);

    await expect(page.getByText('Không có đánh giá nào khớp bộ lọc.')).toBeVisible();
    const pages = api.callsTo('GET', '/admin/reviews').map((c) => c.query.get('page'));
    expect(pages.every((p) => p === '1')).toBe(true);
  });
});
