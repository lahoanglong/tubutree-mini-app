import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { STOREFRONT_TRUST_SHORT_MAX, STOREFRONT_TRUST_TITLE, storefrontTrustChips } from './storefront-trust';

describe('storefrontTrustChips', () => {
  it('đủ bốn chip theo thứ tự, chữ đủ của chip đổi trả nêu số ngày đã cấu hình', () => {
    const chips = storefrontTrustChips(7);
    expect(chips.map((c) => c.key)).toEqual(['reviewed', 'tracking', 'payment', 'returns']);
    expect(chips.map((c) => c.short)).toEqual(['Hàng đã qua duyệt', 'Theo dõi đơn', 'Thanh toán qua Tubu', 'Đổi trả nếu lỗi']);
    expect(chips.map((c) => c.full)).toEqual([
      'Sản phẩm đã qua duyệt của Tubu Tree',
      'Theo dõi đơn trên Tubu Tree',
      'Thanh toán qua Tubu Tree',
      'Đổi trả trong 7 ngày nếu lỗi',
    ]);
  });

  it('số ngày bằng 0: không hứa đổi trả (bỏ chip), ba chip còn lại giữ nguyên', () => {
    expect(storefrontTrustChips(0).map((c) => c.key)).toEqual(['reviewed', 'tracking', 'payment']);
  });

  it.each([undefined, null, -3, Number.NaN, '7'])('chưa biết số ngày (%s): hứa chung, không điền số mặc định', (days) => {
    const returns = storefrontTrustChips(days).find((c) => c.key === 'returns');
    expect(returns?.full).toBe('Đổi trả nếu sản phẩm lỗi');
  });

  it('chữ ngắn vừa hai chip mỗi hàng ở 375px, không dùng thuật ngữ cấm', () => {
    for (const c of storefrontTrustChips(30)) {
      expect(c.short.length, c.short).toBeLessThanOrEqual(STOREFRONT_TRUST_SHORT_MAX);
      for (const text of [c.short, c.full, STOREFRONT_TRUST_TITLE]) {
        for (const term of FORBIDDEN_TERMS) expect(text, `${text} → ${term.use}`).not.toMatch(term.pattern);
      }
    }
  });

  it('mỗi lần gọi trả mảng mới: nơi dùng sửa mảng không làm bẩn lần sau', () => {
    const a = storefrontTrustChips(0);
    a.pop();
    expect(storefrontTrustChips(0)).toHaveLength(3);
  });
});
