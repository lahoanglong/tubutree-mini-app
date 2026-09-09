import { canTransition, assertTransition, isTerminal, ORDER_TRANSITIONS } from './order-transition';

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
