import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON_KEYS, categoryIconKey } from './category-icons';

describe('categoryIconKey', () => {
  it('"Tẩy rửa sinh học" dùng sparkles ở mọi app', () => {
    expect(categoryIconKey('tay-rua-sinh-hoc')).toBe('sparkles');
  });

  it('bảy slug danh mục chuẩn cho bảy khoá icon khác nhau', () => {
    const slugs = ['my-pham-thien-nhien', 'tay-rua-sinh-hoc', 'cho-be', 'cho-me-bau', 'cham-soc-ca-nhan', 'ca-phe-do-uong', 'nong-san-thuc-pham'];
    const keys = slugs.map((s) => categoryIconKey(s));
    expect(keys).toEqual(['flower', 'sparkles', 'baby', 'heart-handshake', 'smile', 'coffee', 'wheat']);
    expect(new Set(keys).size).toBe(7);
    expect(Object.keys(CATEGORY_ICON_KEYS).sort()).toEqual([...slugs].sort());
  });

  it('slug lạ, rỗng hay thiếu: không có khoá (app tự lùi về icon lưới)', () => {
    expect(categoryIconKey('danh-muc-la')).toBeNull();
    expect(categoryIconKey('')).toBeNull();
    expect(categoryIconKey(null)).toBeNull();
    expect(categoryIconKey(undefined)).toBeNull();
  });

  it('tên thuộc tính của Object.prototype không phải slug (không trả hàm, không ném)', () => {
    expect(categoryIconKey('constructor')).toBeNull();
    expect(categoryIconKey('__proto__')).toBeNull();
    expect(categoryIconKey('toString')).toBeNull();
  });
});
