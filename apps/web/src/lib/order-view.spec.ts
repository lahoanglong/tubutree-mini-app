import { describe, expect, it } from 'vitest';
import {
  addressLine,
  canCancelOrder,
  canPayAgain,
  isReorderable,
  ORDER_TABS,
  timelineIndex,
  orderDetailHref,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  orderPaymentStatusLabel,
  orderPaymentStatusShort,
  paymentStatusLabel,
  safeHttpUrl,
  shippingStatusLabel,
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
    // BUYERWEB-4: còn khoản chuyển khoản chưa chuyển xong thì chưa được nói "Đã hoàn tiền".
    const cancelled = { status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'REFUNDED' };
    expect(orderPaymentStatusLabel(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'PENDING' }])).toBe('Đang hoàn tiền');
    expect(orderPaymentStatusLabel(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'PROCESSING' }])).toBe('Đang hoàn tiền');
    // R2-LIFECYCLE-5: đã xong thì nói tiền về đâu.
    expect(orderPaymentStatusLabel(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'COMPLETED' }])).toBe('Đã hoàn tiền về tài khoản ngân hàng');
    expect(orderPaymentStatusLabel(cancelled, [{ method: 'WALLET', status: 'COMPLETED' }])).toBe('Đã hoàn tiền vào Ví Tubu');
    expect(
      orderPaymentStatusLabel(cancelled, [
        { method: 'WALLET', status: 'COMPLETED' },
        { method: 'MANUAL_TRANSFER', status: 'COMPLETED' },
      ]),
    ).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusLabel(cancelled, [])).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' })).toBe('Đã thanh toán');
    expect(orderPaymentStatusLabel({ status: 'DELIVERED', paymentMethod: 'COD' })).toBe('');
  });

  it('admin (ô gọn trong danh sách): COD đã giao → "Đã thu COD", PAID → "Đã TT", trạng thái khác ghi tiếng Việt', () => {
    expect(orderPaymentStatusShort({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('Đã thu COD');
    expect(orderPaymentStatusShort({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('Chưa TT');
    expect(orderPaymentStatusShort({ status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' })).toBe('Đã TT');
    expect(orderPaymentStatusShort({ status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED' })).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusShort({ status: 'CANCELLED', paymentMethod: 'ZALOPAY', paymentStatus: 'FAILED' })).toBe('TT lỗi');
  });
});

describe('canCancelOrder — khớp luật tự hủy của BE (BUYERWEB-13)', () => {
  it('hủy được tới trước khi bàn giao vận chuyển (D1, BUYERWEB-5): Chờ thanh toán / Đã xác nhận / Đang đóng gói', () => {
    expect(canCancelOrder({ status: 'PENDING_PAYMENT' }, 'u1')).toBe(true);
    expect(canCancelOrder({ status: 'CONFIRMED' }, 'u1')).toBe(true);
    expect(canCancelOrder({ status: 'PACKED' }, 'u1')).toBe(true);
    for (const status of ['SHIPPING', 'DELIVERED', 'CANCELLED', 'RETURNED']) {
      expect(canCancelOrder({ status }, 'u1')).toBe(false);
    }
  });

  it('đơn đại lý giữ mốc cũ: Đang đóng gói thì không tự hủy', () => {
    expect(canCancelOrder({ status: 'PACKED', type: 'DEALER' }, 'u1')).toBe(false);
    expect(canCancelOrder({ status: 'CONFIRMED', type: 'DEALER' }, 'u1')).toBe(true);
  });

  it('đơn CTV lên hộ khách đã trả tiền: CTV không tự hủy; khách cuối hoặc đơn chưa trả thì vẫn hủy', () => {
    const o = { status: 'CONFIRMED', placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'ctv1' };
    expect(canCancelOrder(o, 'ctv1')).toBe(false);
    expect(canCancelOrder(o, 'khach')).toBe(true);
    expect(canCancelOrder({ ...o, paymentStatus: 'UNPAID' }, 'ctv1')).toBe(true);
  });

  it('thu gom tái chế mà bưu tá đã lấy hàng: không hủy được nữa; chưa lấy (mã 1/2/10) thì vẫn hủy được', () => {
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '3' }, 'u')).toBe(false);
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '1' }, 'u')).toBe(true);
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: false, gomdonStatus: '3' }, 'u')).toBe(true);
  });
});

describe('hành trình đơn và mua lại', () => {
  it('timelineIndex: 5 bước chuẩn, Đã hủy/Đã hoàn nằm ngoài (-1)', () => {
    expect(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'].map(timelineIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(timelineIndex('CANCELLED')).toBe(-1);
    expect(timelineIndex('RETURNED')).toBe(-1);
  });

  it('chỉ đơn đã kết thúc mới mua lại được', () => {
    expect(['DELIVERED', 'CANCELLED', 'RETURNED'].every(isReorderable)).toBe(true);
    expect(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'].some(isReorderable)).toBe(false);
  });

  it('tab lọc đơn: tab Tất cả không có bộ lọc, các tab còn lại khớp status/group của API', () => {
    expect(ORDER_TABS[0]).toMatchObject({ key: 'all', filter: {} });
    expect(ORDER_TABS.map((t) => t.filter)).toEqual([
      {},
      { status: 'PENDING_PAYMENT' },
      { group: 'processing' },
      { status: 'SHIPPING' },
      { status: 'DELIVERED' },
      { group: 'closed' },
    ]);
  });
});

describe('shippingStatusLabel — trạng thái vận chuyển hãng gửi bằng mã tiếng Anh (R2-ADMINOPS-8)', () => {
  it('mã thường gặp ra tiếng Việt, chữ đã là tiếng Việt giữ nguyên, rỗng ra rỗng', () => {
    expect(shippingStatusLabel('delivering')).toBe('Đang giao');
    expect(shippingStatusLabel('DELIVERED')).toBe('Đã giao');
    expect(shippingStatusLabel('returning')).toBe('Đang hoàn');
    expect(shippingStatusLabel('Đã lấy hàng')).toBe('Đã lấy hàng');
    expect(shippingStatusLabel(null)).toBe('');
  });
});
