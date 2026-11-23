import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '@tubutree/app-core/shop-copy';
import { GUEST_CHECKOUT_COPY, GUEST_CHECKOUT_COPY_BUDGET, guestCopy, type GuestCopyKey } from './copy';

/** Giá trị dài nhất của từng biến: số tiền tới hàng trăm nghìn, ngày dạng dd/mm/yyyy, số món tới trần 30 dòng của giỏ khách. */
const WORST = { amount: '500.000đ', date: '31/12/2026', n: 30 };

describe('chữ đặt hàng không đăng nhập (web)', () => {
  it('chữ và ngân sách cùng tập khoá, không câu rỗng, không dấu chấm than', () => {
    expect(Object.keys(GUEST_CHECKOUT_COPY).sort()).toEqual(Object.keys(GUEST_CHECKOUT_COPY_BUDGET).sort());
    for (const [key, text] of Object.entries(GUEST_CHECKOUT_COPY)) {
      expect(text.trim(), key).not.toBe('');
      expect(text, key).not.toContain('!');
    }
  });

  it('điền giá trị dài nhất vẫn trong ngân sách', () => {
    for (const [key, max] of Object.entries(GUEST_CHECKOUT_COPY_BUDGET) as [GuestCopyKey, number | null][]) {
      if (max === null) continue;
      expect(guestCopy(key, WORST).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('không câu nào dính thuật ngữ cấm', () => {
    for (const [key, text] of Object.entries(GUEST_CHECKOUT_COPY)) {
      expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.use), key).toEqual([]);
    }
  });

  it('thiếu biến thì báo lỗi kèm tên khoá, không lộ {amount} ra trang', () => {
    expect(() => guestCopy('loginLine')).toThrow('guestCheckout.loginLine');
    expect(guestCopy('loginLine', { amount: '30.000đ' })).toBe('Đã có tài khoản? Đăng nhập Zalo để dùng mã, Điểm Xanh và quà đơn đầu 30.000đ');
  });
});
