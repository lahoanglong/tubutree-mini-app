import { describe, it, expect } from 'vitest';
import { shippingEventLabel, SHIPPING_STATUS_UNKNOWN } from './format-shipping';

// Pancake ghi nguyên `partner_status` của hãng vận chuyển vào lịch sử đơn ("delivering",
// "ready_to_pick"...) — khách không được thấy mã tiếng Anh (C-120).
describe('shippingEventLabel — trạng thái hãng vận chuyển → tiếng Việt', () => {
  it('mã tiếng Anh phổ biến được dịch', () => {
    expect(shippingEventLabel('delivering')).toBe('Đang giao hàng');
    expect(shippingEventLabel('delivered')).toBe('Giao hàng thành công');
    expect(shippingEventLabel('ready_to_pick')).toBe('Chờ lấy hàng');
    expect(shippingEventLabel('picking')).toBe('Đang lấy hàng');
    expect(shippingEventLabel('picked')).toBe('Đã lấy hàng');
    expect(shippingEventLabel('transporting')).toBe('Đang vận chuyển');
    expect(shippingEventLabel('delivery_fail')).toBe('Giao không thành công');
    expect(shippingEventLabel('returning')).toBe('Đang hoàn hàng');
    expect(shippingEventLabel('returned')).toBe('Đã hoàn hàng');
    expect(shippingEventLabel('cancel')).toBe('Đã huỷ vận đơn');
  });

  it('không phân biệt hoa/thường, khoảng trắng hay gạch', () => {
    expect(shippingEventLabel('  DELIVERING ')).toBe('Đang giao hàng');
    expect(shippingEventLabel('Ready To Pick')).toBe('Chờ lấy hàng');
    expect(shippingEventLabel('delivery-fail')).toBe('Giao không thành công');
  });

  it('chuỗi đã là tiếng Việt (Gomdon/BestExpress) giữ nguyên', () => {
    expect(shippingEventLabel('Đang giao hàng')).toBe('Đang giao hàng');
    expect(shippingEventLabel('Giao hàng thành công')).toBe('Giao hàng thành công');
  });

  it('mã lạ không dịch được → "Đang cập nhật", KHÔNG in chuỗi gốc', () => {
    expect(shippingEventLabel('xyz_weird_code')).toBe(SHIPPING_STATUS_UNKNOWN);
    expect(shippingEventLabel('1234')).toBe(SHIPPING_STATUS_UNKNOWN);
    expect(SHIPPING_STATUS_UNKNOWN).toBe('Đang cập nhật');
  });

  it('rỗng/null/undefined → null để nơi gọi tự hiện "—"', () => {
    expect(shippingEventLabel(null)).toBeNull();
    expect(shippingEventLabel(undefined)).toBeNull();
    expect(shippingEventLabel('   ')).toBeNull();
  });
});
