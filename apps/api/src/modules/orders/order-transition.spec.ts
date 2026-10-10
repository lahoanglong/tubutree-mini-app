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
    expect(requiresPaymentBefore('SHIPPING')).toBe(true);
    expect(requiresPaymentBefore('DELIVERED')).toBe(true);
    for (const s of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'CANCELLED', 'RETURNED'] as const) {
      expect(requiresPaymentBefore(s)).toBe(false);
    }
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

  it('trạng thái không cần thanh toán (PACKED, CANCELLED) → không chặn', () => {
    expect(() => assertPaidBeforeFulfilment(unpaidBank, 'PENDING_PAYMENT', 'PACKED')).not.toThrow();
    expect(() => assertPaidBeforeFulfilment(unpaidBank, 'PENDING_PAYMENT', 'CANCELLED')).not.toThrow();
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

  it('trả trước chưa PAID → bỏ SHIPPING/DELIVERED, giữ CONFIRMED/PACKED/CANCELLED', () => {
    expect(allowedNextStatuses({ ...base, status: 'PENDING_PAYMENT' })).toEqual(['CONFIRMED', 'PACKED', 'CANCELLED']);
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
