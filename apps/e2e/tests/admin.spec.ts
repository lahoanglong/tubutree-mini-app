import { test, expect, type MockApi } from './support/mock-api';
import type { DealerApp, Page } from '../../web/src/lib/admin-client';

/**
 * Web Admin Dashboard E2E — tab "Đại lý" (duyệt hồ sơ đại lý).
 *
 * Dùng fixture mock-api dùng chung (tests/support/mock-api.ts): MỌI request `/api/**` của trang đi qua
 * một bộ định tuyến — không khớp mock → 404 E2E_UNMOCKED và test FAIL, nên trang không lén gọi API dev
 * thật ở :3001 (trước đây chỉ mock 2 route, các lời gọi còn lại của trang rò ra mạng thật).
 *
 * Mở thẳng `/admin?tab=dealers` (trang đọc `?tab=` từ URL — readUrlState trong app/admin/page.tsx): tab
 * mặc định là "Tổng quan KPI", assert nội dung tab Đại lý mà không mở tab thì không bao giờ thấy.
 *
 * Mock trả ĐÚNG dạng API thật: GET /admin/dealer-applications trả `paginated()` = `{ data, meta }`
 * (admin.service.ts listDealerApplications), không phải mảng trần.
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

function dealerApp(over: Partial<DealerApp> & Pick<DealerApp, 'id' | 'businessName' | 'createdAt'>): DealerApp {
  return {
    ownerName: 'Nguyễn Thị Lan',
    phone: '0901234567',
    address: '123 Đường A, Quận 1',
    taxCode: null,
    cccdFrontUrl: '',
    cccdBackUrl: '',
    status: 'PENDING',
    ...over,
  };
}

function page<T>(data: T[], p: number, limit: number, total: number): Page<T> {
  return { data, meta: { page: p, limit, total } };
}

/** Phiên admin giả: /auth/refresh (auth-context.tsx khôi phục phiên khi có cờ `tubu_web_session`) + badge giỏ hàng ở header. */
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

test.describe('Web Admin Dashboard E2E - Luồng Duyệt Đại Lý', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    // Refresh token thật nằm ở cookie HttpOnly do BE set — test không giả được. Thứ auth-context.tsx nhìn để
    // quyết định có gọi /auth/refresh hay không là cờ `tubu_web_session` trong localStorage; đặt TRƯỚC khi
    // script của trang chạy (addInitScript) thay vì goto → evaluate → reload.
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('Hiển thị và Duyệt hồ sơ Đại lý', async ({ page: p, api }) => {
    let reviewed = false;
    const colan = dealerApp({ id: 'dealer-123', businessName: 'Tạp hoá Cô Lan', createdAt: '2026-09-20T08:00:00.000Z' });
    api.get('/admin/dealer-applications', ({ call }) => {
      const limit = Number(call.query.get('limit') ?? 20);
      const rows = call.query.get('status') === 'PENDING' && !reviewed ? [colan] : [];
      return page(rows, Number(call.query.get('page') ?? 1), limit, rows.length);
    });
    api.post('/admin/dealer-applications/:id/review', () => {
      reviewed = true;
      return { ok: true };
    });

    await p.goto('/admin?tab=dealers');

    await expect(p.getByText('Tạp hoá Cô Lan')).toBeVisible({ timeout: 15_000 });
    await expect(p.getByText('Nguyễn Thị Lan · 0901234567')).toBeVisible();
    await expect(p.getByText('Hiển thị 1/1 hồ sơ')).toBeVisible();
    const list = api.callsTo('GET', '/admin/dealer-applications');
    expect(list[0]!.query.get('status')).toBe('PENDING');
    expect(list[0]!.query.get('page')).toBe('1');

    // Nút Duyệt khoá tới khi nhập Tier ID (BE bắt buộc tierId khi duyệt).
    const approve = p.getByRole('button', { name: 'Duyệt', exact: true });
    await expect(approve).toBeDisabled();
    await p.fill('input[placeholder*="Tier"]', 'dealer_l1');

    // Exact match bắt buộc: tab bar có nút "Duyệt SP đối tác" chứa "Duyệt" như chuỗi con.
    const reviewCall = api.waitForCall('POST', '/admin/dealer-applications/:id/review');
    await approve.click();
    const call = await reviewCall;
    expect(call.path).toBe('/admin/dealer-applications/dealer-123/review');
    expect(call.body).toEqual({ approve: true, tierId: 'dealer_l1' });

    // Duyệt xong → danh sách chờ được tải lại, hồ sơ rời hàng chờ.
    await expect(p.getByText('Không có hồ sơ.')).toBeVisible();
    await expect(p.getByText('Tạp hoá Cô Lan')).toHaveCount(0);
  });

  test('Hàng chờ quá 1 trang: hiện tổng, "Tải thêm" tải hồ sơ cũ hơn và xếp cũ nhất lên đầu', async ({ page: p, api }) => {
    // API xếp mới nhất trước (createdAt desc): trang 1 = 100 hồ sơ mới, trang 2 = hồ sơ cũ nhất.
    const newer = Array.from({ length: 100 }, (_, i) =>
      dealerApp({
        id: `d-${i}`,
        businessName: `Đại lý mới ${i}`,
        createdAt: new Date(Date.UTC(2026, 8, 25, 0, 0, 0) - i * 60_000).toISOString(),
      }),
    );
    const oldest = dealerApp({ id: 'd-old', businessName: 'Đại lý chờ lâu nhất', createdAt: '2026-08-01T00:00:00.000Z' });
    api.get('/admin/dealer-applications', ({ call }) => {
      const pg = Number(call.query.get('page') ?? 1);
      const limit = Number(call.query.get('limit') ?? 20);
      return page(pg === 1 ? newer : [oldest], pg, limit, 101);
    });

    await p.goto('/admin?tab=dealers');

    await expect(p.getByText('Hiển thị 100/101 hồ sơ')).toBeVisible({ timeout: 15_000 });
    await expect(p.getByText(/Còn 1 hồ sơ cũ hơn chưa tải/)).toBeVisible();
    await expect(p.getByText('Đại lý chờ lâu nhất')).toHaveCount(0);

    const more = api.waitForCall('GET', '/admin/dealer-applications');
    await p.getByRole('button', { name: 'Tải thêm' }).click();
    expect((await more).query.get('page')).toBe('2');

    await expect(p.getByText('Hiển thị 101/101 hồ sơ')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
    await expect(p.getByText(/Còn \d+ hồ sơ cũ hơn chưa tải/)).toHaveCount(0);
    // Hồ sơ chờ lâu nhất đứng TRƯỚC mọi hồ sơ mới hơn.
    const text = await p.locator('main').innerText();
    expect(text.indexOf('Đại lý chờ lâu nhất')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Đại lý chờ lâu nhất')).toBeLessThan(text.indexOf('Đại lý mới 99'));
    expect(text.indexOf('Đại lý mới 99')).toBeLessThan(text.indexOf('Đại lý mới 0'));
  });
});
