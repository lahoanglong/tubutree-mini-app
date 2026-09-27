import { test, expect, type MockApi } from './support/mock-api';
import type { RetentionDailyRow } from '../../web/src/lib/admin-client';

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

/** Phiên admin giả — cùng cơ chế `mockAdminSession` đã dùng trong admin.spec.ts (không export
 *  được nên chép lại tối thiểu ở đây, không import chéo giữa 2 file test). */
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

test.describe('Admin — tab Retention & North-star', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('có snapshot → hiển thị số liệu ngày mới nhất', async ({ page: p, api }) => {
    const rows: RetentionDailyRow[] = [
      {
        date: '2026-09-26T00:00:00.000Z',
        newBuyers: 5,
        activeBuyers: 8,
        ordersCount: 12,
        ordersPerBuyerMtd: 4.1,
        dauProxyRefreshToken: 30,
        dauEventBased: null,
      },
    ];
    api.get('/admin/analytics/retention-daily', rows);

    await p.goto('/admin?tab=analytics');

    await expect(p.getByText('Retention & North-star')).toBeVisible();
    await expect(p.getByText('Khách mới hôm qua')).toBeVisible();
    // "5" (newBuyers) xuất hiện CẢ ở StatCard lẫn ở dòng bảng bên dưới (cùng snapshot mới nhất) →
    // getByText('5', {exact:true}) trần vi phạm strict mode (khớp 2 phần tử). Thu hẹp về đúng
    // StatCard "Khách mới hôm qua" rồi mới assert số bên trong nó.
    const newBuyersCard = p.locator('div.rounded-lg', { hasText: 'Khách mới hôm qua' });
    await expect(newBuyersCard.getByText('5', { exact: true })).toBeVisible();
  });

  test('snapshot rỗng (cron chưa chạy lần nào) → hiện thông báo, KHÔNG crash', async ({ page: p, api }) => {
    api.get('/admin/analytics/retention-daily', []);

    await p.goto('/admin?tab=analytics');

    await expect(p.getByText('Retention & North-star')).toBeVisible();
    await expect(p.getByText('Chưa có snapshot nào')).toBeVisible();
  });
});
