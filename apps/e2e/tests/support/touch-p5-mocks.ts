import type { Page } from '@playwright/test';
import type { NotificationDTO } from '../../../miniapp/src/services/account-api';
import { makeUser, mockSession, type MockApi } from './mock-api';
import { mockDiscovery } from './discovery-mocks';
import { mockFlashSlots } from './flash-slot-mocks';
import { STATES, mockWorld, type OrderState, type OrderWorld, type Side } from './order-detail-states';

/**
 * Dữ liệu giả cho cổng W41B (Tìm kiếm + Bộ lọc, Giờ vàng, Chi tiết đơn, Thông báo) ở 320 / 360 / 375px, dùng chung Mini App và web.
 * Mọi lời gọi API đi qua mock; không thêm thành phần mới, chỉ dựng trạng thái đủ dài để lộ tràn ngang và số không đều.
 */

/** Đơn đang giao có mã dài, tên dòng dài, địa chỉ dài: trạng thái xấu nhất của chi tiết đơn ở khổ hẹp. */
export const LONG_ORDER_CODE = 'TUBU20261107001234567890';
const LONG_STREET = 'Căn hộ 12A05, Tầng 12A, Tòa nhà Sunrise Riverside Block C, số 18 Nguyễn Hữu Thọ';

export async function mockLongOrder(api: MockApi, page: Page, side: Side): Promise<OrderWorld> {
  const base = STATES.find((s) => s.key === 'shipping')!;
  const state: OrderState = {
    ...base,
    world: (now: number): OrderWorld => {
      const w = base.world(now);
      return {
        ...w,
        order: {
          ...w.order,
          code: LONG_ORDER_CODE,
          voucherDiscount: 15_000,
          couponCode: 'TUBUTREE-GIAM-NHIEU-DIP-CUOI-NAM',
          trackingNumber: 'GHN-8800123456789012',
          siblings: [
            { code: 'TUBU20261107001234567891', status: 'SHIPPING', total: 1_249_000, fulfillerName: 'Gian hàng Mộc An Sài Gòn' },
            { code: 'TUBU20261107001234567892', status: 'PENDING', total: 86_000, fulfillerName: 'Tubu Tree' },
          ],
          shippingAddress: { ...w.order.shippingAddress!, street: LONG_STREET },
        } as OrderWorld['order'],
      };
    },
  };
  return mockWorld(api, page, side, state, Date.now());
}

const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();

/** Ba tin: chưa đọc có số đơn dài, đã đọc, và nhắc mua lại có chữ dài, đủ để dò vùng chạm, tràn ngang và số đều. */
export const NOTIFICATIONS: NotificationDTO[] = [
  { id: 'n-1', templateCode: 'ORDER_SHIPPING', payload: { body: `Đơn ${LONG_ORDER_CODE} đang trên đường giao tới bạn. Mã vận đơn GHN-8800123456789012.`, data: { order_code: LONG_ORDER_CODE } }, status: 'SENT', sentAt: iso(5 * 60_000) },
  { id: 'n-2', templateCode: 'ORDER_DELIVERED', payload: { body: 'Đơn TUBU20261105001 đã giao thành công. Cảm ơn bạn đã chọn Tubu Tree.', data: { order_code: 'TUBU20261105001' } }, status: 'READ', sentAt: iso(26 * 3600_000) },
  { id: 'n-3', templateCode: 'REORDER_REMINDER', payload: { body: 'Nước Rửa Chén Sinh Học Tubu 500ml của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé!', data: { product: 'Nước Rửa Chén Sinh Học Tubu 500ml', variation_id: 'var-1', product_slug: 'nuoc-rua-chen-tubu' } }, status: 'SENT', sentAt: iso(3 * 24 * 3600_000) },
];

export function mockNotifications(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-p5', fullName: 'Nguyễn Văn An' }));
  api.get('/me/notifications', NOTIFICATIONS);
  api.get('/me/summary', { unreadNotifications: 2 });
  api.post('/me/notifications/read-all', { ok: true, count: 2 });
  api.post('/me/notifications/:id/read', { ok: true });
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('GET /cart', 'GET /config/public', 'GET /flash-sales/active', 'GET /me/coupons', 'GET /me/wishlist/ids');
}

export function mockBrowse(api: MockApi): void {
  mockDiscovery(api);
}

/** Lịch sử tìm đã có sẵn trong máy khách (cùng khoá và chủ với mockDiscovery, nếu không app xoá vì khác chủ). */
export async function seedRecentSearches(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa chén', 'xà phòng thảo mộc', 'túi vải canvas']));
      localStorage.setItem('tubu_recent_searches_owner', 'user-4b');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có lịch sử
    }
  });
}

export function mockFlashPage(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-p5', fullName: 'Nguyễn Văn An' }));
  mockFlashSlots(api);
}
