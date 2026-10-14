import {
  canTransition,
  assertTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  InvalidOrderTransitionError,
  UnpaidPrepaidTransitionError,
  assertPaidBeforeFulfilment,
  requiresPaymentBefore,
  allowedNextStatuses,
  cancelHandover,
} from './order-transition';

describe('order-transition', () => {
  it('cho phép luồng giao hàng thuận: PENDING_PAYMENT → CONFIRMED → PACKED → SHIPPING → DELIVERED', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'PACKED')).toBe(true);
    expect(canTransition('PACKED', 'SHIPPING')).toBe(true);
    expect(canTransition('SHIPPING', 'DELIVERED')).toBe(true);
  });

  it('cho phép hủy khi đơn chưa rời kho', () => {
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('PACKED', 'CANCELLED')).toBe(true);
    expect(canTransition('SHIPPING', 'CANCELLED')).toBe(true);
  });

  it('DELIVERED chỉ đi tiếp được sang RETURNED', () => {
    expect(canTransition('DELIVERED', 'RETURNED')).toBe(true);
    expect(canTransition('DELIVERED', 'CONFIRMED')).toBe(false);
    expect(canTransition('DELIVERED', 'PENDING_PAYMENT')).toBe(false);
    expect(canTransition('DELIVERED', 'SHIPPING')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('CANCELLED và RETURNED là trạng thái cuối — không có đường ra (trừ self-transition)', () => {
    for (const to of Object.keys(ORDER_TRANSITIONS)) {
      if (to === 'CANCELLED') continue;
      expect(canTransition('CANCELLED', to as never)).toBe(false);
    }
    for (const to of Object.keys(ORDER_TRANSITIONS)) {
      if (to === 'RETURNED') continue;
      expect(canTransition('RETURNED', to as never)).toBe(false);
    }
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('RETURNED')).toBe(true);
    expect(isTerminal('DELIVERED')).toBe(false);
  });

  it('cho phép nhảy cóc về phía trước (Pancake/POS thường không báo đủ PACKED/SHIPPING)', () => {
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(true);
    expect(canTransition('CONFIRMED', 'SHIPPING')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PACKED')).toBe(true);
    expect(canTransition('PACKED', 'DELIVERED')).toBe(true);
  });

  it('không cho lùi ngược quy trình giao hàng', () => {
    expect(canTransition('SHIPPING', 'PACKED')).toBe(false);
    expect(canTransition('PACKED', 'CONFIRMED')).toBe(false);
    expect(canTransition('CONFIRMED', 'PENDING_PAYMENT')).toBe(false);
  });

  it('chuyển sang chính nó là no-op hợp lệ (idempotent webhook)', () => {
    expect(canTransition('CONFIRMED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(true);
  });

  it('assertTransition ném lỗi có nêu rõ from → to', () => {
    expect(() => assertTransition('DELIVERED', 'CONFIRMED')).toThrow(/DELIVERED/);
    expect(() => assertTransition('DELIVERED', 'CONFIRMED')).toThrow(/CONFIRMED/);
    expect(() => assertTransition('CONFIRMED', 'PACKED')).not.toThrow();
  });

  it('mọi trạng thái đều có mục trong bảng chuyển trạng thái', () => {
    const all = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...all].sort());
  });
});

describe('order-transition — đơn trả trước phải PAID trước khi giao (C-024)', () => {
  const unpaidBank = { code: 'TUBU1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

  it('SHIPPING/DELIVERED cần thanh toán trước; các trạng thái khác thì không', () => {
    expect(requiresPaymentBefore('CONFIRMED', 'SHIPPING')).toBe(true);
    expect(requiresPaymentBefore('PACKED', 'DELIVERED')).toBe(true);
    for (const s of ['CONFIRMED', 'PACKED', 'CANCELLED', 'RETURNED'] as const) {
      expect(requiresPaymentBefore('CONFIRMED', s)).toBe(false);
    }
  });

  // Review lượt 1: "Xác nhận" đơn chuyển khoản chưa trả đẩy nó sang CONFIRMED+UNPAID — cron chỉ quét
  // PENDING_PAYMENT nên kho/quota flash/coupon bị giữ vĩnh viễn. Rời PENDING_PAYMENT (trừ huỷ) chỉ qua markPaid.
  it('rời PENDING_PAYMENT sang bất kỳ mốc tiến nào cũng cần thanh toán; huỷ thì không', () => {
    for (const to of ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const) {
      expect(requiresPaymentBefore('PENDING_PAYMENT', to)).toBe(true);
    }
    expect(requiresPaymentBefore('PENDING_PAYMENT', 'CANCELLED')).toBe(false);
    expect(requiresPaymentBefore('PENDING_PAYMENT', 'PENDING_PAYMENT')).toBe(false);
  });

  it('BANK_TRANSFER/ZALOPAY/VNPAY chưa PAID → chặn SHIPPING và DELIVERED bằng lỗi chuyển trạng thái (400 / webhook bỏ qua êm)', () => {
    for (const paymentMethod of ['BANK_TRANSFER', 'ZALOPAY', 'VNPAY']) {
      for (const paymentStatus of ['UNPAID', 'FAILED', 'REFUNDED']) {
        for (const to of ['SHIPPING', 'DELIVERED'] as const) {
          const run = () => assertPaidBeforeFulfilment({ ...unpaidBank, paymentMethod, paymentStatus }, 'PACKED', to);
          expect(run).toThrow(UnpaidPrepaidTransitionError);
          expect(run).toThrow(InvalidOrderTransitionError);
        }
      }
    }
  });

  it('trả trước đã PAID → cho đi', () => {
    expect(() =>
      assertPaidBeforeFulfilment({ ...unpaidBank, paymentStatus: 'PAID' }, 'CONFIRMED', 'DELIVERED'),
    ).not.toThrow();
  });

  it('COD chưa thu tiền → vẫn giao được (thu khi giao)', () => {
    expect(() =>
      assertPaidBeforeFulfilment({ ...unpaidBank, paymentMethod: 'COD' }, 'CONFIRMED', 'DELIVERED'),
    ).not.toThrow();
  });

  it('đơn đại lý ghi công nợ (CREDIT) → giao được dù UNPAID', () => {
    expect(() =>
      assertPaidBeforeFulfilment({ ...unpaidBank, onCredit: true }, 'CONFIRMED', 'SHIPPING'),
    ).not.toThrow();
  });

  it('đơn đã CONFIRMED (dữ liệu cũ) → PACKED/CANCELLED không chặn; PENDING_PAYMENT → CANCELLED không chặn', () => {
    expect(() => assertPaidBeforeFulfilment(unpaidBank, 'CONFIRMED', 'PACKED')).not.toThrow();
    expect(() => assertPaidBeforeFulfilment(unpaidBank, 'CONFIRMED', 'CANCELLED')).not.toThrow();
    expect(() => assertPaidBeforeFulfilment(unpaidBank, 'PENDING_PAYMENT', 'CANCELLED')).not.toThrow();
  });

  it('PENDING_PAYMENT chưa trả → CONFIRMED/PACKED bị chặn (chỉ "Đã nhận tiền" mới xác nhận)', () => {
    for (const to of ['CONFIRMED', 'PACKED'] as const) {
      expect(() => assertPaidBeforeFulfilment(unpaidBank, 'PENDING_PAYMENT', to)).toThrow(UnpaidPrepaidTransitionError);
      expect(() =>
        assertPaidBeforeFulfilment({ ...unpaidBank, paymentMethod: 'ZALOPAY' }, 'PENDING_PAYMENT', to),
      ).toThrow(UnpaidPrepaidTransitionError);
    }
  });
});

// Web admin chỉ hiện nút chuyển trạng thái hợp lệ theo API (C-024 yêu cầu 3) — trước đây tự đoán bằng điều
// kiện cứng nên hiện "Hủy đơn" trên đơn DELIVERED, "Đã giao hàng" trên đơn chuyển khoản chưa trả… bấm mới 400.
describe('allowedNextStatuses', () => {
  const base = { code: 'TB-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

  it('không gồm chính nó; khớp bảng chuyển trạng thái với đơn đã PAID/COD', () => {
    expect(allowedNextStatuses({ ...base, status: 'CONFIRMED', paymentStatus: 'PAID' })).toEqual([
      'PACKED',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ]);
    expect(allowedNextStatuses({ ...base, status: 'PACKED', paymentMethod: 'COD' })).toEqual([
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ]);
  });

  it('trả trước chưa PAID → ở PENDING_PAYMENT chỉ còn huỷ; đã CONFIRMED/PACKED thì bỏ SHIPPING/DELIVERED', () => {
    expect(allowedNextStatuses({ ...base, status: 'PENDING_PAYMENT' })).toEqual(['CANCELLED']);
    expect(allowedNextStatuses({ ...base, status: 'CONFIRMED' })).toEqual(['PACKED', 'CANCELLED']);
    expect(allowedNextStatuses({ ...base, status: 'PACKED', paymentMethod: 'ZALOPAY' })).toEqual(['CANCELLED']);
  });

  it('đơn đại lý ghi công nợ → không bị khoá giao', () => {
    expect(allowedNextStatuses({ ...base, status: 'CONFIRMED', onCredit: true })).toContain('DELIVERED');
  });

  it('DELIVERED chỉ còn RETURNED; CANCELLED/RETURNED không còn đường ra', () => {
    expect(allowedNextStatuses({ ...base, status: 'DELIVERED', paymentStatus: 'PAID' })).toEqual(['RETURNED']);
    expect(allowedNextStatuses({ ...base, status: 'CANCELLED' })).toEqual([]);
    expect(allowedNextStatuses({ ...base, status: 'RETURNED' })).toEqual([]);
  });

  it('trạng thái lạ (dữ liệu hỏng) → rỗng, không ném', () => {
    expect(allowedNextStatuses({ ...base, status: 'SHIPPED' })).toEqual([]);
  });
});

describe('cancelHandover (D1: chỉ huỷ được tới khi bàn giao vận chuyển)', () => {
  const live = { status: 'PACKED' };

  it('chưa có dấu hiệu bàn giao → huỷ được', () => {
    expect(cancelHandover(live)).toBeNull();
    expect(cancelHandover({ status: 'CONFIRMED', shippingCode: null, shippedAt: null })).toBeNull();
  });

  it('đơn đang giao → chặn', () => {
    expect(cancelHandover({ status: 'SHIPPING' })).toEqual({ kind: 'SHIPPING', detail: 'đơn đang giao' });
  });

  it('đã có mã vận đơn hãng (Pancake) dù còn PACKED → chặn', () => {
    expect(cancelHandover({ ...live, shippingCode: 'GHN777', shippingPartner: 'GHN' })?.kind).toBe('CARRIER_WAYBILL');
  });

  it('gian hàng tự giao đã báo gửi hàng (shippedAt) → chặn', () => {
    expect(cancelHandover({ ...live, shippedAt: new Date() })?.kind).toBe('MERCHANT_SHIPPED');
  });

  it('vận đơn Gomdon mới tạo (bưu tá chưa lấy) KHÔNG tính là bàn giao', () => {
    const gomdon = { ...live, hasRecyclingPickup: true, gomdonOrderId: '9001', gomdonPartnerCode: 'BEX1', shippingCode: 'BEX1', gomdonStatus: '1' };
    expect(cancelHandover(gomdon)).toBeNull();
    expect(cancelHandover({ ...gomdon, gomdonStatus: '10' })).toBeNull();
  });

  it('bưu tá Gomdon đã lấy hàng → chặn (kể cả webhook SHIPPING chưa tới)', () => {
    const picked = { ...live, hasRecyclingPickup: true, gomdonOrderId: '9001', gomdonPartnerCode: 'BEX1', shippingCode: 'BEX1', gomdonStatus: '3' };
    expect(cancelHandover(picked)?.kind).toBe('GOMDON_PICKED_UP');
    expect(cancelHandover({ ...picked, status: 'SHIPPING', gomdonStatus: '6' })?.kind).toBe('SHIPPING');
  });

  it('Gomdon báo đã hoàn hàng về kho / mất hàng → hàng không còn ở hãng, huỷ được dù đơn đang SHIPPING', () => {
    const back = { status: 'SHIPPING', hasRecyclingPickup: true, gomdonOrderId: '9001', gomdonPartnerCode: 'BEX1', shippingCode: 'BEX1' };
    expect(cancelHandover({ ...back, gomdonStatus: '8' })).toBeNull();
    expect(cancelHandover({ ...back, gomdonStatus: '9' })).toBeNull();
  });

  it('Pancake tự báo huỷ: mã vận đơn hãng (kho đã đặt hãng, bưu tá chưa lấy) chưa phải bàn giao — Pancake huỷ thì huỷ luôn vận đơn', () => {
    const booked = { status: 'PACKED', shippingCode: 'GHN1', shippingPartner: 'GHN' };
    expect(cancelHandover(booked, { pancakeReportedCancel: true })).toBeNull();
    expect(cancelHandover(booked)?.kind).toBe('CARRIER_WAYBILL');
    expect(cancelHandover({ ...booked, status: 'SHIPPING' }, { pancakeReportedCancel: true })?.kind).toBe('SHIPPING');
    expect(cancelHandover({ ...booked, shippedAt: new Date() }, { pancakeReportedCancel: true })?.kind).toBe('MERCHANT_SHIPPED');
    const picked = { status: 'CONFIRMED', hasRecyclingPickup: true, gomdonOrderId: '9', gomdonPartnerCode: 'B9', shippingCode: 'B9', gomdonStatus: '3' };
    expect(cancelHandover(picked, { pancakeReportedCancel: true })?.kind).toBe('GOMDON_PICKED_UP');
  });
});

describe('allowedNextStatuses — không hiện Huỷ sau khi bàn giao (D1)', () => {
  const paid = { code: 'TB-1', paymentMethod: 'WALLET', paymentStatus: 'PAID' };

  it('đơn đang giao → không còn CANCELLED', () => {
    expect(allowedNextStatuses({ ...paid, status: 'SHIPPING' })).toEqual(['DELIVERED']);
  });

  it('đơn PACKED đã có mã vận đơn hãng → không còn CANCELLED', () => {
    expect(allowedNextStatuses({ ...paid, status: 'PACKED', shippingCode: 'GHN1' })).not.toContain('CANCELLED');
  });

  it('đơn gian hàng đã gửi / bưu tá Gomdon đã lấy → không còn CANCELLED', () => {
    expect(allowedNextStatuses({ ...paid, status: 'CONFIRMED', shippedAt: new Date() })).not.toContain('CANCELLED');
    expect(
      allowedNextStatuses({ ...paid, status: 'CONFIRMED', hasRecyclingPickup: true, gomdonPartnerCode: 'B1', shippingCode: 'B1', gomdonStatus: '3' }),
    ).not.toContain('CANCELLED');
  });
});
