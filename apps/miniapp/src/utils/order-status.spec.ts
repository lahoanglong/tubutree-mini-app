import { describe, it, expect } from 'vitest';
import { isReorderable, orderUnitCount } from './order-status';

describe('order-status helpers', () => {
  it('mua lại được với đơn đã xong (giao/huỷ/hoàn) — cùng điều kiện nút ở chi tiết đơn', () => {
    expect(['DELIVERED', 'CANCELLED', 'RETURNED'].every(isReorderable)).toBe(true);
    expect(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'].some(isReorderable)).toBe(false);
  });
  it('số món = tổng số lượng, không phải số dòng (A2-47)', () => {
    expect(orderUnitCount([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
    expect(orderUnitCount([])).toBe(0);
  });
});
