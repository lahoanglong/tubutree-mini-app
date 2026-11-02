import { describe, expect, it } from 'vitest';
import { trustBadgeLabel } from './storefront-badge';

describe('trustBadgeLabel: nhãn tin cậy chỉ cho gian hàng admin đã duyệt', () => {
  it.each([
    ['CTV', 'CTV tuyển chọn'],
    ['MERCHANT', 'Đối tác của Tubu Tree'],
    ['BRAND', 'Nhãn hàng trên Tubu Tree'],
  ] as const)('%s đã duyệt: "%s"', (type, label) => {
    expect(trustBadgeLabel({ type, approved: true })).toBe(label);
  });

  it('chưa duyệt hoặc API cũ chưa trả cờ: không có nhãn (không tick, không "CTV tuyển chọn")', () => {
    expect(trustBadgeLabel({ type: 'CTV', approved: false })).toBeNull();
    expect(trustBadgeLabel({ type: 'CTV' })).toBeNull();
  });
});
