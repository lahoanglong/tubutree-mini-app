import { describe, it, expect, vi } from 'vitest';

// Trang kéo zmp-ui/zmp-sdk (cần môi trường Zalo/DOM) — test chỉ nhắm helper thuần nên thay bằng stub rỗng.
vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Sheet: () => null,
  Checkbox: () => null, Radio: () => null, Switch: () => null,
  useNavigate: () => () => undefined,
  useSnackbar: () => ({ openSnackbar: () => undefined, closeSnackbar: () => undefined }),
}));
vi.mock('zmp-sdk/apis', () => ({ vibrate: () => undefined, setStorage: async () => ({}), getStorage: async () => ({}), removeStorage: async () => ({}) }));

import { notificationMeta, notificationOrderLink } from './notifications';
import { reminderFallbackPath } from '../components/reorder/reorder-reminder';

/**
 * Nhãn nhóm thông báo theo templateCode. Trước đây mọi mã DEALER_* (thưởng doanh số quý, yêu cầu
 * nhận thưởng) và OPS_* (báo động vận hành gửi tài khoản ADMIN — admin đăng nhập mini app vẫn thấy
 * trong danh sách) rơi về nhãn chung "Thông báo".
 */
describe('notificationMeta', () => {
  it.each([
    'DEALER_BONUS_PAID',
    'DEALER_REWARD_CLAIM_NEW',
    'DEALER_REWARD_CLAIM_APPROVED',
    'DEALER_REWARD_CLAIM_REJECTED',
    'DEALER_REWARD_CLAIM_PAID',
  ])('%s → nhóm Đại lý', (code) => {
    expect(notificationMeta(code).title).toBe('Đại lý');
  });

  it('OPS_* → Cảnh báo vận hành', () => {
    expect(notificationMeta('OPS_GOMDON_ALERT').title).toBe('Cảnh báo vận hành');
  });

  it('giữ nguyên các nhóm cũ + fallback', () => {
    expect(notificationMeta('ORDER_CONFIRMED').title).toBe('Đơn đã xác nhận');
    expect(notificationMeta('ORDER_CANCELLED').title).toBe('Cập nhật đơn hàng');
    expect(notificationMeta('FLASH_REMINDER').title).toBe('Ưu đãi giờ vàng');
    expect(notificationMeta('SOMETHING_NEW').title).toBe('Thông báo');
  });

  // A1-01=A2-06=A3-02: trước đây REORDER_REMINDER rơi về nhãn chung "Thông báo" (Bell) — khách
  // không phân biệt được đây là nhắc mua lại với mọi thông báo chung chung khác.
  it('REORDER_REMINDER → nhóm Nhắc mua lại', () => {
    expect(notificationMeta('REORDER_REMINDER').title).toBe('Nhắc mua lại');
  });
});

describe('đích dự phòng của CTA "Mua lại ngay" (reminderFallbackPath — A1-01=A2-06=A3-02)', () => {
  it('có product_slug trong payload → điều hướng thẳng tới trang sản phẩm', () => {
    expect(reminderFallbackPath({ product_slug: 'dau-goi-visante-500ml' })).toBe('/product/dau-goi-visante-500ml');
  });

  it('không có slug (đơn cũ trước khi OrderItem có cột productSlug) → /orders (spec 4a.4) thay vì link hỏng /product/', () => {
    expect(reminderFallbackPath({ product: 'Dầu gội Visante 500ml' })).toBe('/orders');
    expect(reminderFallbackPath(undefined)).toBe('/orders');
  });

  it('slug có ký tự cần encode → encodeURIComponent đúng (mirror flashSlug cùng file)', () => {
    expect(reminderFallbackPath({ product_slug: 'sữa tắm/đặc biệt' })).toBe(
      `/product/${encodeURIComponent('sữa tắm/đặc biệt')}`,
    );
  });
});

describe('REORDER_REMINDER không vô tình khớp CTA khác (isGame/isCart/isLoyalty heuristic theo body text)', () => {
  // Body thật (seed.ts nt-reorder): '{{product}} của bạn dự kiến sắp hết. Đặt lại ngay để không
  // gián đoạn nhé! 🛒' — emoji 🛒 KHÔNG phải chữ "giỏ" nên isCart (/giỏ/i) không khớp nhầm.
  it('body mẫu thật của REORDER_REMINDER không chứa từ khoá "giỏ"', () => {
    const body = 'Dầu gội Visante 500ml của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé! 🛒';
    expect(/giỏ/i.test(body)).toBe(false);
  });
});

describe('notificationOrderLink', () => {
  it('thông báo đơn của chính khách → có nút xem đơn', () => {
    expect(notificationOrderLink('ORDER_SHIPPING', 'TUBU1')).toBe(true);
    expect(notificationOrderLink('ORDER_SHIPPING', undefined)).toBe(true);
    expect(notificationOrderLink('INVOICE_ISSUED', 'TUBU1')).toBe(true);
  });

  // Báo động OPS mang order_code của đơn KHÁCH KHÁC — GET /orders/:code chỉ trả đơn của chính
  // người xem (404 với admin), nên nút "Xem chi tiết đơn hàng" dẫn tới màn lỗi.
  it('OPS_* có order_code của khách khác → KHÔNG hiện nút xem đơn', () => {
    expect(notificationOrderLink('OPS_GOMDON_ALERT', 'TUBU1')).toBe(false);
  });
});
