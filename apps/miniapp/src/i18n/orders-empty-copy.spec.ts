import { describe, it, expect } from 'vitest';
import { vi } from './vi';

describe('màn đơn hàng trống (C-115, D5-10)', () => {
  const body = vi.orders.emptyBody('199.000đ', '30.000đ');

  it('không còn câu "Mua đơn đầu — nhận 30k voucher" (voucher được cấp TRƯỚC đơn đầu)', () => {
    expect(body).not.toMatch(/Mua đơn đầu/i);
    expect(body).not.toMatch(/voucher/i);
  });

  it('nói đúng điều kiện của mã chào mừng bằng số truyền vào: đơn đầu từ ngưỡng, mã giảm giá theo mệnh giá', () => {
    expect(body).toBe('Đơn đầu từ 199.000đ dùng được mã giảm giá chào mừng 30.000đ');
    expect(vi.orders.emptyBody('99.000đ', '15.000đ')).toBe('Đơn đầu từ 99.000đ dùng được mã giảm giá chào mừng 15.000đ');
  });

  it('mã không đòi đơn tối thiểu thì không nói "từ …"', () => {
    expect(vi.orders.emptyBodyNoMin('30.000đ')).toBe('Đơn đầu dùng được mã giảm giá chào mừng 30.000đ');
  });
});
