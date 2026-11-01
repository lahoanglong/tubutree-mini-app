import { describe, expect, it } from 'vitest';
import { givenName } from './person-name';

describe('givenName — tên gọi của họ tên Việt (từ cuối)', () => {
  it('lấy từ cuối của họ tên, bỏ khoảng trắng thừa', () => {
    expect(givenName('Nguyễn Thị Quay Lại')).toBe('Lại');
    expect(givenName('  Nguyễn   Văn An  ')).toBe('An');
  });

  it('một từ thì giữ nguyên, không cắt giữa từ', () => {
    expect(givenName('An')).toBe('An');
    expect(givenName('Nguyễn')).toBe('Nguyễn');
  });

  it('bỏ dấu câu và emoji ở hai đầu từ, lùi về từ trước khi từ cuối chỉ còn ký hiệu', () => {
    expect(givenName('Hoa (Mẹ Bắp)')).toBe('Bắp');
    expect(givenName('🌸 Hoa 🌸')).toBe('Hoa');
  });

  it('không có chữ nào thì null để nơi gọi dùng lời chào dự phòng', () => {
    expect(givenName('🌸')).toBeNull();
    expect(givenName('')).toBeNull();
    expect(givenName('   ')).toBeNull();
    expect(givenName(null)).toBeNull();
    expect(givenName(undefined)).toBeNull();
  });
});
