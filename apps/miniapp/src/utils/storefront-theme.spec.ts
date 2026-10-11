import { describe, it, expect } from 'vitest';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from './storefront-theme';

describe('bảng màu chủ đạo gian hàng', () => {
  it('mọi màu đúng dạng #rrggbb mà API storefront chấp nhận', () => {
    for (const c of STOREFRONT_THEME_COLORS) expect(c.code).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('mã màu và nhãn không trùng nhau', () => {
    expect(new Set(STOREFRONT_THEME_COLORS.map((c) => c.code.toLowerCase())).size).toBe(STOREFRONT_THEME_COLORS.length);
    expect(new Set(STOREFRONT_THEME_COLORS.map((c) => c.label)).size).toBe(STOREFRONT_THEME_COLORS.length);
  });

  it('màu mặc định là xanh lá, khớp mặc định phía API (getPublicBySlug) và có trong bảng', () => {
    expect(DEFAULT_STOREFRONT_THEME_COLOR).toBe('#16a34a');
    expect(STOREFRONT_THEME_COLORS.map((c) => c.code)).toContain(DEFAULT_STOREFRONT_THEME_COLOR);
  });
});
