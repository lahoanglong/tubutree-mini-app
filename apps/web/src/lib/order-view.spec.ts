import { describe, expect, it } from 'vitest';
import {
  addressLine,
  buyerOrderStatusLabel,
  canCancelOrder,
  discountRows,
  isHandedToCarrier,
  isRefundInProgress,
  orderPointsNote,
  orderStamp,
  returnWindowState,
  isReorderable,
  ORDER_TABS,
  timelineIndex,
  orderDetailHref,
  bankPaymentHref,
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
  it('bankPaymentHref mã hoá mã đơn vào trang chuyển khoản như /bank-payment/:code của Mini App', () => {
    expect(bankPaymentHref('TB260927-001')).toBe('/thanh-toan/chuyen-khoan/TB260927-001');
    expect(bankPaymentHref('A/B?#')).toBe('/thanh-toan/chuyen-khoan/A%2FB%3F%23');
  });

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

// R4-ADMIN-1: danh sách đơn admin và CSV từng ghi "Đã hoàn tiền" khi khoản chuyển khoản trả khách còn Chờ/Đang chuyển, trong
// khi khách thấy "Đang hoàn tiền". Một hàm quyết định cho cả hai phía.
describe('R6-ADMIN-2 — đơn huỷ có khoản tiền về muộn đang chờ hoàn', () => {
  const lateOrder = { status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

  it('UNPAID + LATE_PAYMENT/OVERPAYMENT chờ hoặc đang chuyển là Đang hoàn tiền ở danh sách và chi tiết', () => {
    for (const kind of ['LATE_PAYMENT', 'OVERPAYMENT']) {
      for (const status of ['PENDING', 'PROCESSING']) {
        const refunds = [{ kind, method: 'MANUAL_TRANSFER', status }];
        expect(isRefundInProgress(lateOrder, refunds)).toBe(true);
        expect(orderPaymentStatusShort(lateOrder, refunds)).toBe('Đang hoàn tiền');
        expect(orderPaymentStatusLabel(lateOrder, refunds)).toBe('Đang hoàn tiền');
      }
    }
  });

  it('đơn đã PAID chuyển dư đang chờ hoàn vẫn là Đã thanh toán', () => {
    const paid = { status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' };
    expect(isRefundInProgress(paid, [{ kind: 'OVERPAYMENT', method: 'MANUAL_TRANSFER', status: 'PENDING' }])).toBe(false);
  });

  it('khoản đã xong, chờ đối soát hoặc đơn không có khoản nào thì giữ nhãn cũ', () => {
    expect(orderPaymentStatusShort(lateOrder, [{ kind: 'LATE_PAYMENT', method: 'MANUAL_TRANSFER', status: 'COMPLETED' }])).toBe('Chưa TT');
    expect(orderPaymentStatusShort(lateOrder, [{ kind: 'LATE_PAYMENT', method: 'MANUAL_TRANSFER', status: 'UNVERIFIED' }])).toBe('Chưa TT');
    expect(orderPaymentStatusShort(lateOrder, [{ kind: 'CANCEL', method: 'MANUAL_TRANSFER', status: 'PENDING' }])).toBe('Chưa TT');
    expect(orderPaymentStatusShort(lateOrder, [])).toBe('Chưa TT');
  });
});

describe('isRefundInProgress — một luật "Đang hoàn tiền" cho khách và admin', () => {
  const cancelled = { status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'REFUNDED' };

  it('REFUNDED + khoản chuyển khoản Chờ/Đang chuyển → đang hoàn; đã chuyển, Ví, chờ đối soát, bỏ qua → không', () => {
    expect(isRefundInProgress(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'PENDING' }])).toBe(true);
    expect(isRefundInProgress(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'PROCESSING' }])).toBe(true);
    expect(isRefundInProgress(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'COMPLETED' }])).toBe(false);
    expect(isRefundInProgress(cancelled, [{ method: 'WALLET', status: 'COMPLETED' }])).toBe(false);
    expect(isRefundInProgress(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'UNVERIFIED' }])).toBe(false);
    expect(isRefundInProgress(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'DISMISSED' }])).toBe(false);
    expect(isRefundInProgress(cancelled, undefined)).toBe(false);
    expect(isRefundInProgress({ ...cancelled, paymentStatus: 'PAID' }, [{ method: 'MANUAL_TRANSFER', status: 'PENDING' }])).toBe(false);
  });

  it('admin (ô gọn): "Đang hoàn tiền" khi khoản chuyển khoản còn Chờ/Đang chuyển, khớp nhãn của khách', () => {
    const pending = [{ method: 'MANUAL_TRANSFER', status: 'PENDING' }];
    const processing = [{ method: 'MANUAL_TRANSFER', status: 'PROCESSING' }];
    expect(orderPaymentStatusShort(cancelled, pending)).toBe('Đang hoàn tiền');
    expect(orderPaymentStatusShort(cancelled, processing)).toBe('Đang hoàn tiền');
    expect(orderPaymentStatusShort(cancelled, [{ method: 'MANUAL_TRANSFER', status: 'COMPLETED' }])).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusShort(cancelled)).toBe('Đã hoàn tiền');
    expect(orderPaymentStatusLabel(cancelled, pending)).toBe(orderPaymentStatusShort(cancelled, pending));
  });

  it('nhãn chi tiết bỏ qua khoản chờ đối soát / đã bỏ qua khi nói tiền về đâu', () => {
    expect(
      orderPaymentStatusLabel(cancelled, [
        { method: 'WALLET', status: 'COMPLETED' },
        { method: 'MANUAL_TRANSFER', status: 'DISMISSED' },
      ]),
    ).toBe('Đã hoàn tiền vào Ví Tubu');
    expect(
      orderPaymentStatusLabel(cancelled, [
        { method: 'MANUAL_TRANSFER', status: 'COMPLETED' },
        { method: 'MANUAL_TRANSFER', status: 'UNVERIFIED' },
      ]),
    ).toBe('Đã hoàn tiền về tài khoản ngân hàng');
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

  it('kho đã đặt hãng (mã vận đơn không phải của Gomdon): không bày nút hủy — BE từ chối "đã bàn giao" (R3-CANCEL-2)', () => {
    expect(canCancelOrder({ status: 'PACKED', shippingCode: 'GHN1933' }, 'u1')).toBe(false);
    expect(canCancelOrder({ status: 'PACKED', shippingCode: 'BE1', hasRecyclingPickup: true, gomdonPartnerCode: 'BE1' }, 'u1')).toBe(true);
  });

  it('API trả canCancel thì theo API (cùng luật lần huỷ thật); trạng thái đã đóng thì vẫn ẩn dù cờ cũ còn true', () => {
    expect(canCancelOrder({ status: 'PACKED', canCancel: false }, 'u1')).toBe(false);
    expect(canCancelOrder({ status: 'PACKED', shippingCode: 'GHN1', canCancel: true }, 'u1')).toBe(true);
    expect(canCancelOrder({ status: 'CANCELLED', canCancel: true }, 'u1')).toBe(false);
  });

  it('thu gom tái chế mà bưu tá đã lấy hàng: không hủy được nữa; chưa lấy (mã 1/2/10) thì vẫn hủy được', () => {
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '3' }, 'u')).toBe(false);
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '1' }, 'u')).toBe(true);
    expect(canCancelOrder({ status: 'CONFIRMED', hasRecyclingPickup: false, gomdonStatus: '3' }, 'u')).toBe(true);
  });
});

describe('buyerOrderStatusLabel — đơn đã có mã vận đơn hãng (R3-CANCEL-2)', () => {
  it('Đã xác nhận/Đang đóng gói mà kho đã đặt hãng → "Đã đặt đơn vị vận chuyển"', () => {
    expect(buyerOrderStatusLabel({ status: 'PACKED', shippingCode: 'GHN1933' })).toBe('Đã đặt đơn vị vận chuyển');
    expect(buyerOrderStatusLabel({ status: 'CONFIRMED', shippingCode: 'GHN1933' })).toBe('Đã đặt đơn vị vận chuyển');
  });

  it('mã vận đơn Gomdon (thu gom) hay trạng thái khác giữ nhãn gốc', () => {
    expect(buyerOrderStatusLabel({ status: 'PACKED' })).toBe('Đang đóng gói');
    expect(buyerOrderStatusLabel({ status: 'PACKED', shippingCode: 'BE1', gomdonOrderId: 'BE1' })).toBe('Đang đóng gói');
    expect(buyerOrderStatusLabel({ status: 'SHIPPING', shippingCode: 'GHN1933' })).toBe('Đang giao');
    expect(buyerOrderStatusLabel({ status: 'CANCELLED', shippingCode: 'GHN1933' })).toBe('Đã hủy');
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

// R4-BUYER-7: Order.discount gộp mã + combo + giảm hạng + Điểm Xanh; khách phải thấy từng khoản (cùng cách tách với Mini App).
describe('discountRows — tách từng khoản giảm giá của đơn', () => {
  it('đơn có chi tiết từng khoản: mỗi khoản một dòng, mã kèm tên mã, Điểm Xanh kèm số điểm', () => {
    expect(
      discountRows({ discount: 98_000, couponCode: 'XANH10', couponDiscount: 38_000, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 60_000, pointsUsed: 60 }),
    ).toEqual([
      { label: 'Mã giảm giá (XANH10)', amount: 38_000 },
      { label: 'Điểm Xanh (60 điểm)', amount: 60_000 },
    ]);
  });

  it('combo, hạng thành viên và phần giảm không rõ nguồn đều có dòng riêng; tổng các dòng = discount', () => {
    const rows = discountRows({ discount: 100_000, couponDiscount: 0, comboDiscount: 30_000, tierDiscount: 20_000, pointsDiscount: 0, pointsUsed: 0 });
    expect(rows).toEqual([
      { label: 'Ưu đãi combo', amount: 30_000 },
      { label: 'Ưu đãi hạng thành viên', amount: 20_000 },
      { label: 'Giảm giá khác', amount: 50_000 },
    ]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100_000);
  });

  it('số điểm có dấu nghìn: "Điểm Xanh (1.250 điểm)"', () => {
    expect(discountRows({ discount: 12_500, couponDiscount: 0, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 12_500, pointsUsed: 1250 })).toEqual([
      { label: 'Điểm Xanh (1.250 điểm)', amount: 12_500 },
    ]);
  });

  it('đơn tách của gian hàng đối tác không giữ lượt dùng mã: lấy tên mã của lần đặt (groupCouponCode)', () => {
    expect(
      discountRows({ discount: 15_000, couponCode: null, groupCouponCode: 'XANH10', couponDiscount: 15_000, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0 }),
    ).toEqual([{ label: 'Mã giảm giá (XANH10)', amount: 15_000 }]);
  });

  it('đơn cũ chưa lưu từng khoản: một dòng Giảm giá, ghi rõ đã gồm Điểm Xanh nếu có dùng điểm; không giảm thì không có dòng', () => {
    expect(discountRows({ discount: 98_000, pointsUsed: 60 })).toEqual([{ label: 'Giảm giá (gồm Điểm Xanh)', amount: 98_000 }]);
    expect(discountRows({ discount: 38_000, pointsUsed: 0 })).toEqual([{ label: 'Giảm giá', amount: 38_000 }]);
    expect(discountRows({ discount: 0, pointsUsed: 0 })).toEqual([]);
  });
});

describe('orderStamp — mốc thời gian đầu trang chi tiết đơn', () => {
  it('đơn đã giao có mốc giao thì hiện "Giao lúc", còn lại "Đặt lúc"', () => {
    expect(orderStamp({ status: 'DELIVERED', createdAt: 'a', deliveredAt: 'b' })).toEqual({ label: 'Giao lúc', at: 'b' });
    expect(orderStamp({ status: 'DELIVERED', createdAt: 'a', deliveredAt: null })).toEqual({ label: 'Đặt lúc', at: 'a' });
    expect(orderStamp({ status: 'SHIPPING', createdAt: 'a', deliveredAt: 'b' })).toEqual({ label: 'Đặt lúc', at: 'a' });
  });
});

describe('orderPointsNote — dòng Điểm Xanh theo trạng thái đơn', () => {
  it('không có điểm hoặc đơn đã huỷ thì không có dòng', () => {
    expect(orderPointsNote('DELIVERED', 0)).toBeNull();
    expect(orderPointsNote('CANCELLED', 50)).toBeNull();
  });
  it('chưa giao: sẽ nhận; đã giao: đã cộng; đã hoàn: đã thu hồi', () => {
    expect(orderPointsNote('CONFIRMED', 1200)).toEqual({ text: 'Nhận +1.200 Điểm Xanh khi giao thành công', tone: 'success' });
    expect(orderPointsNote('DELIVERED', 50)).toEqual({ text: 'Đã cộng +50 Điểm Xanh vào tài khoản', tone: 'success' });
    expect(orderPointsNote('RETURNED', 50)).toEqual({ text: 'Điểm Xanh của đơn này đã được thu hồi', tone: 'muted' });
  });
  it('trả hàng một phần: số thực thu của API thắng; chưa có thì ghi "tối đa"', () => {
    expect(orderPointsNote('DELIVERED', 50, 30, 20)).toEqual({ text: 'Đã cộng +50, đã thu lại 20 điểm do trả hàng', tone: 'muted' });
    expect(orderPointsNote('DELIVERED', 50, 30)).toEqual({ text: 'Đã cộng +50, đã thu lại tối đa 30 do trả hàng', tone: 'muted' });
    expect(orderPointsNote('DELIVERED', 50, 0, 0)).toEqual({ text: 'Đã cộng +50 Điểm Xanh vào tài khoản', tone: 'success' });
  });
});

describe('returnWindowState — hạn đổi/trả theo mốc giao', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  it('còn hạn kèm số ngày còn lại, quá hạn thì đóng', () => {
    expect(returnWindowState({ deliveredAt: '2026-10-08T00:00:00Z' }, 7, now)).toEqual({ open: true, daysLeft: 5 });
    expect(returnWindowState({ deliveredAt: '2026-10-01T00:00:00Z' }, 7, now)).toEqual({ open: false, daysLeft: 0 });
  });
  it('thiếu mốc giao thì dùng updatedAt, không có mốc nào thì để API quyết định', () => {
    expect(returnWindowState({ updatedAt: '2026-10-01T00:00:00Z' }, 7, now).open).toBe(false);
    expect(returnWindowState({}, 7, now)).toEqual({ open: true, daysLeft: 7 });
  });
});

describe('isHandedToCarrier — hàng đã rời kho', () => {
  it('đang giao hoặc kho đã đặt hãng; mã vận đơn Gomdon không tính', () => {
    expect(isHandedToCarrier({ status: 'SHIPPING' })).toBe(true);
    expect(isHandedToCarrier({ status: 'PACKED', shippingCode: 'GHN1' })).toBe(true);
    expect(isHandedToCarrier({ status: 'PACKED', shippingCode: 'G1', gomdonOrderId: 'G1' })).toBe(false);
    expect(isHandedToCarrier({ status: 'CONFIRMED' })).toBe(false);
  });
});
