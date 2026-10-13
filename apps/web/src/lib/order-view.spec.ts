import { describe, expect, it } from 'vitest';
import {
  addressLine,
  canPayAgain,
  orderDetailHref,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  orderPaymentStatusLabel,
  orderPaymentStatusShort,
  paymentStatusLabel,
  safeHttpUrl,
} from './order-view';

describe('order-view — nhãn và đường dẫn đơn hàng (C-025)', () => {
  it('orderDetailHref mã hoá mã đơn vào đường dẫn chi tiết', () => {
    expect(orderDetailHref('TB260927-001')).toBe('/tai-khoan/don-hang/TB260927-001');
    expect(orderDetailHref('a/b c')).toBe('/tai-khoan/don-hang/a%2Fb%20c');
  });

  it('nhãn trạng thái đơn bằng tiếng Việt có dấu, lạ thì giữ nguyên', () => {
    expect(orderStatusLabel('PENDING_PAYMENT')).toBe('Chờ thanh toán');
    expect(orderStatusLabel('DELIVERED')).toBe('Đã giao');
    expect(orderStatusLabel('CANCELLED')).toBe('Đã hủy');
    expect(orderStatusLabel('WHATEVER')).toBe('WHATEVER');
  });

  it('tông màu: chờ thanh toán = cảnh báo, hủy/hoàn = trung tính, còn lại = xanh', () => {
    expect(orderStatusTone('PENDING_PAYMENT')).toContain('warning');
    expect(orderStatusTone('CANCELLED')).toContain('stone');
    expect(orderStatusTone('RETURNED')).toContain('stone');
    expect(orderStatusTone('SHIPPING')).toContain('forest');
  });

  it('nhãn phương thức và trạng thái thanh toán', () => {
    expect(paymentMethodLabel('COD')).toBe('Thanh toán khi nhận hàng (COD)');
    expect(paymentMethodLabel('BANK_TRANSFER')).toBe('Chuyển khoản ngân hàng');
    expect(paymentMethodLabel('WALLET')).toBe('Ví Tubu');
    expect(paymentMethodLabel('XU')).toBe('Điểm Xanh (xu cũ)');
    expect(paymentMethodLabel('LẠ')).toBe('LẠ');
    expect(paymentStatusLabel('UNPAID')).toBe('Chưa thanh toán');
    expect(paymentStatusLabel('PAID')).toBe('Đã thanh toán');
    expect(paymentStatusLabel('REFUNDED')).toBe('Đã hoàn tiền');
    expect(paymentStatusLabel(undefined)).toBe('');
  });

  it('chỉ đơn chuyển khoản đang chờ thanh toán mới được trả lại bằng QR', () => {
    expect(canPayAgain({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' })).toBe(true);
    expect(canPayAgain({ status: 'PENDING_PAYMENT', paymentMethod: 'COD' })).toBe(false);
    // API từ chối sinh QR cho đơn đã hủy/trả — không dựng khung QR để khỏi hiện lỗi.
    expect(canPayAgain({ status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER' })).toBe(false);
    expect(canPayAgain({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER' })).toBe(false);
  });

  it('addressLine bỏ phần rỗng, không để dấu phẩy thừa', () => {
    expect(addressLine({ street: '1 Xuân Thuỷ', ward: 'Cầu Giấy', district: '', province: 'Hà Nội' })).toBe('1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    expect(addressLine({})).toBe('');
    expect(addressLine(null)).toBe('');
  });

  it('safeHttpUrl chỉ nhận http/https (link tra cứu vận đơn do đối tác vận chuyển trả về)', () => {
    expect(safeHttpUrl('https://tracking.example/abc')).toBe('https://tracking.example/abc');
    expect(safeHttpUrl('http://x.vn/a')).toBe('http://x.vn/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });
});

describe('UAT GOMDON-11: đơn COD đã giao không hiện "Chưa thanh toán"', () => {
  it('khách: COD + Đã giao + UNPAID → "Đã thu tiền khi giao"; các trường hợp khác giữ nhãn cũ', () => {
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('Đã thu tiền khi giao');
    expect(orderPaymentStatusLabel({ status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('Chưa thanh toán');
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' })).toBe('Chưa thanh toán');
    expect(orderPaymentStatusLabel({ status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED' })).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' })).toBe('Đã thanh toán');
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'COD' })).toBe('');
  });

  it('admin (ô gọn trong danh sách): COD đã giao → "Đã thu COD", PAID → "Đã TT", còn lại giữ mã', () => {
    expect(orderPaymentStatusShort({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('Đã thu COD');
    expect(orderPaymentStatusShort({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('UNPAID');
    expect(orderPaymentStatusShort({ status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' })).toBe('Đã TT');
    expect(orderPaymentStatusShort({ status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED' })).toBe('REFUNDED');
  });
});
