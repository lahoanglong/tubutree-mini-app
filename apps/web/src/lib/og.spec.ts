import { describe, expect, it } from 'vitest';
import { ogBase, withBrand } from './og';

describe('ogBase', () => {
  it('đủ trường để openGraph của trang con không mất siteName, locale, ảnh mặc định (có alt)', () => {
    expect(ogBase).toEqual({
      type: 'website',
      siteName: 'Tubu Tree',
      locale: 'vi_VN',
      images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: 'Tubu Tree' }],
    });
  });

  it('withBrand thêm hậu tố như template tiêu đề gốc', () => {
    expect(withBrand('Giờ vàng')).toBe('Giờ vàng — Tubu Tree');
  });
});
