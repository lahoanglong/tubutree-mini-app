import { test, expect, type MockApi } from './support/mock-api';

/**
 * Admin, tab Chiến dịch: khối "Kiểm trước khi bật" và xem trước banner. Đích sản phẩm sai thì thấy lỗi chặn đỏ và không bật được;
 * sửa đích thì "Sẵn sàng" và lưu được bằng MỘT lệnh tạo đang bật. Nút Lưu khoá theo `verdict` của máy chủ. Mọi lệnh gọi /api/ được giả, kể cả bước kiểm.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const IMAGE = 'https://img.test/banner.svg';
const BANNER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600"><rect width="1500" height="600" fill="#2f6b3a"/></svg>';
const BAD_SLUG_MESSAGE = 'Không có sản phẩm với slug "sua-hat-sai". Kiểm lại slug.';

const listRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `cd-${id}`,
  title: `Chiến dịch ${id}`,
  subtitle: null,
  placement: 'HOME_TOP',
  image: null,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-10-31T17:00:00.000Z',
  endAt: '2026-11-10T16:59:00.000Z',
  sortOrder: 0,
  isActive: true,
  productCount: 1,
  couponCount: 0,
  status: 'live',
  health: { blockers: 0, warnings: 0 },
  ...over,
});

function mockAdmin(api: MockApi, rows: unknown[] = []) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', { generatedAt: '2026-11-01T03:00:00.000Z', items: [] });
  api.get('/admin/ops/health', { generatedAt: '2026-11-01T03:00:00.000Z', problems: [], cronJobs: [] });
  api.get('/admin/dashboard/today', { orders: { today: 5, yesterday: 3, week: 20 }, revenue: { today: 1500000, yesterday: 2000000, week: 9000000 }, newUsers: { today: 2, yesterday: 2, week: 11 } });
  api.get('/admin/analytics/retention-daily', []);
  api.get('/admin/campaigns', rows);
}

test.describe('Admin: kiểm chiến dịch trước khi bật', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
    // Đăng ký sau fixture nên được ưu tiên: ảnh banner 1500×600 đúng khung 5:2.
    await page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: BANNER_SVG }));
  });

  test('đích sản phẩm sai: thấy lỗi chặn, không bật được; sửa đích thì "Sẵn sàng" và bật được', async ({ page, api }) => {
    mockAdmin(api);
    api.post('/admin/campaigns/check', ({ call }) => {
      const b = call.body as { linkType: string; linkValue?: string };
      if (b.linkType === 'PRODUCT' && b.linkValue === 'sua-hat-sai') {
        return {
          issues: [{ code: 'INVALID', level: 'BLOCK', message: BAD_SLUG_MESSAGE }],
          blockers: 1,
          warnings: 0,
          verdict: { blocked: true, codes: ['INVALID'], reason: BAD_SLUG_MESSAGE },
        };
      }
      return { issues: [], blockers: 0, warnings: 0, verdict: { blocked: false, codes: [] } };
    });
    api.post('/admin/campaigns', ({ call }) => ({ id: 'new1', ...(call.body as object) }));
    api.patch('/admin/campaigns/:id', ({ params, call }) => ({ id: params.id, ...(call.body as object) }));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=campaigns');
    await page.getByRole('button', { name: 'Tạo chiến dịch' }).click();
    await page.getByRole('textbox', { name: 'Tên chiến dịch' }).fill('Sữa hạt giữa thu');
    await page.getByRole('textbox', { name: 'Link ảnh ảnh banner (tỉ lệ 5:2, ví dụ 1500×600)' }).fill(IMAGE);
    await page.getByRole('textbox', { name: 'Bắt đầu: ngày' }).fill('01/11/2026');
    await page.getByRole('textbox', { name: 'Kết thúc: ngày' }).fill('30/11/2026');
    await page.getByRole('combobox', { name: 'Đích khi bấm' }).selectOption('PRODUCT');
    await page.getByRole('textbox', { name: 'Slug sản phẩm' }).fill('sua-hat-sai');

    const check = page.getByRole('region', { name: 'Kiểm trước khi bật' });
    await expect(check.locator('[data-level="BLOCK"]')).toContainText(BAD_SLUG_MESSAGE);
    const save = page.getByRole('button', { name: 'Lưu chiến dịch' });
    await expect(save).toBeDisabled();
    await expect(page.getByTestId('campaign-check-lock')).toContainText(BAD_SLUG_MESSAGE);
    expect(api.callsTo('POST', '/admin/campaigns')).toHaveLength(0);

    await page.getByRole('textbox', { name: 'Slug sản phẩm' }).fill('sua-hat');
    await expect(check.getByTestId('campaign-check-ready')).toHaveText('Sẵn sàng');
    await expect(save).toBeEnabled();

    const created = api.waitForCall('POST', '/admin/campaigns');
    await save.click();
    expect((await created).body).toMatchObject({ linkType: 'PRODUCT', linkValue: 'sua-hat', isActive: true });
    await expect(page.getByText('Đã lưu chiến dịch.')).toBeVisible();
    expect(api.callsTo('POST', '/admin/campaigns')).toHaveLength(1);
    expect(api.callsTo('PATCH', '/admin/campaigns/:id')).toHaveLength(0);
  });

  test('xem trước banner: khung điện thoại rộng 375px và khung máy tính, cả hai dựng bằng băng chuyền thật', async ({ page, api }) => {
    mockAdmin(api);
    api.post('/admin/campaigns/check', { issues: [], blockers: 0, warnings: 0 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=campaigns');
    await page.getByRole('button', { name: 'Tạo chiến dịch' }).click();
    await page.getByRole('textbox', { name: 'Tên chiến dịch' }).fill('Giữa Thu');
    await page.getByRole('textbox', { name: 'Link ảnh ảnh banner (tỉ lệ 5:2, ví dụ 1500×600)' }).fill(IMAGE);

    const phone = page.getByTestId('campaign-preview-phone');
    const desktop = page.getByTestId('campaign-preview-desktop');
    await expect(phone.locator('section[aria-roledescription="carousel"] img')).toBeVisible();
    await expect(desktop.locator('section[aria-roledescription="carousel"] img')).toBeVisible();
    expect((await phone.boundingBox())!.width).toBeCloseTo(375, 0);
    // Slide Trang chủ: khung rộng 343px (375 trừ lề 16px hai bên) tỉ lệ 5/2.
    const slide = await phone.locator('img').boundingBox();
    expect(slide!.width / slide!.height).toBeCloseTo(2.5, 1);

    // Ưu đãi: khung máy tính đổi sang 4/1, khung điện thoại vẫn 5/2.
    await page.getByRole('combobox', { name: 'Vị trí' }).selectOption('OFFERS_TOP');
    const wide = await desktop.locator('img').boundingBox();
    expect(wide!.width / wide!.height).toBeCloseTo(4, 1);
    const still = await phone.locator('img').boundingBox();
    expect(still!.width / still!.height).toBeCloseTo(2.5, 1);
  });

  test('danh sách: huy hiệu lỗi chặn/cảnh báo, lọc "Có vấn đề", nút Bật của dòng còn lỗi chặn bị khoá kèm lý do', async ({ page, api }) => {
    mockAdmin(api, [
      listRow('ok'),
      listRow('xau', { status: 'off', isActive: false, health: { blockers: 2, warnings: 1 } }),
      listRow('canhbao', { health: { blockers: 0, warnings: 3 } }),
    ]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin?tab=campaigns');
    await expect(page.getByText('2 lỗi chặn')).toBeVisible();
    await expect(page.getByText('1 cảnh báo')).toBeVisible();
    await expect(page.getByText('3 cảnh báo')).toBeVisible();
    const on = page.getByRole('button', { name: 'Bật chiến dịch Chiến dịch xau' });
    await expect(on).toBeDisabled();
    await expect(on).toHaveAttribute('title', /2 lỗi chặn/);

    await page.getByRole('button', { name: 'Có vấn đề' }).click();
    await expect(page.getByText('Chiến dịch ok')).toHaveCount(0);
    await expect(page.getByText('Chiến dịch xau')).toBeVisible();
    await expect(page.getByText('Chiến dịch canhbao')).toBeVisible();
  });
});
