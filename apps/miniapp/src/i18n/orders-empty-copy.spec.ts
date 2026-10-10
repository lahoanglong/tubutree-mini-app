import { describe, it, expect } from 'vitest';
import { vi } from './vi';

describe('màn đơn hàng trống (C-115)', () => {
  const body = vi.orders.emptyBody;

  it('không còn câu "Mua đơn đầu — nhận 30k voucher" (voucher được cấp TRƯỚC đơn đầu)', () => {
    expect(body).not.toMatch(/Mua đơn đầu/i);
    expect(body).not.toMatch(/voucher/i);
  });

  it('nói đúng điều kiện của mã chào mừng: đơn đầu từ 199.000đ, mã giảm giá 30.000đ', () => {
    expect(body).toContain('199.000đ');
    expect(body).toContain('30.000đ');
    expect(body.toLowerCase()).toContain('mã giảm giá');
  });
});
