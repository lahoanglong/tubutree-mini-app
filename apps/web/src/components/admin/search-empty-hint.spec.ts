import { describe, expect, it } from 'vitest';
import { searchEmptyHint } from './search-empty-hint';

describe('searchEmptyHint', () => {
  it('người xem bị che SĐT gõ dở số: nói phải gõ đủ 10 số', () => {
    expect(searchEmptyHint('0912', { phoneMasked: true })).toBe('Gõ đủ 10 số SĐT để tìm theo khách.');
    expect(searchEmptyHint('091 234 567', { phoneMasked: true })).toBe('Gõ đủ 10 số SĐT để tìm theo khách.');
    expect(searchEmptyHint('+8491234', { phoneMasked: true })).toBe('Gõ đủ 10 số SĐT để tìm theo khách.');
  });

  it('người thấy đủ SĐT hoặc đã gõ đủ 10 số thì không nhắc về số', () => {
    expect(searchEmptyHint('0912', { phoneMasked: false })).toBeNull();
    expect(searchEmptyHint('0912345678', { phoneMasked: true })).toBeNull();
  });

  it('chuỗi dưới 3 ký tự: tìm theo khách cần ít nhất 3 ký tự', () => {
    expect(searchEmptyHint('An', { phoneMasked: false })).toBe('Gõ ít nhất 3 ký tự để tìm theo khách.');
  });

  it('tên không có chữ số: gợi ý gõ họ tên đầy đủ hơn nếu tên quá phổ biến', () => {
    expect(searchEmptyHint('Nguyễn', { phoneMasked: false })).toBe('Nếu tên quá phổ biến, gõ họ tên đầy đủ hơn.');
  });

  it('mã đơn hoặc chuỗi có chữ số lẫn chữ: không gợi ý thêm; rỗng thì null', () => {
    expect(searchEmptyHint('TB10', { phoneMasked: true })).toBeNull();
    expect(searchEmptyHint('#TT-20261001-0001', { phoneMasked: false })).toBeNull();
    expect(searchEmptyHint('', { phoneMasked: true })).toBeNull();
    expect(searchEmptyHint('   ', { phoneMasked: true })).toBeNull();
  });
});
