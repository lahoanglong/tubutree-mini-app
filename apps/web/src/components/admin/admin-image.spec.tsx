// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { directImageSrc, isAdminImageRef } from './admin-image';

describe('isAdminImageRef', () => {
  it.each([
    '/admin/reviews/r1/images/0?v=0123456789',
    '/admin/merchant-products/p1/images/product/thumb?v=0123456789',
    '/admin/merchant-products/p1/images/draft/3?v=0123456789',
  ])('nhận %s', (ref) => expect(isAdminImageRef(ref)).toBe(true));

  it.each([
    '/admin/orders/export',
    '/admin/reviews/r1/images/0',
    '/admin/reviews/../x/images/0?v=0123456789',
    '/admin/merchant-products/p1/images/other/0?v=0123456789',
    'https://evil.example/admin/reviews/r1/images/0?v=0123456789',
    null,
  ])('từ chối %s', (ref) => expect(isAdminImageRef(ref)).toBe(false));
});

describe('directImageSrc', () => {
  it('https và đường dẫn công khai của API được nhận; chuỗi lạ bị bỏ', () => {
    expect(directImageSrc('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(directImageSrc('/public-image/product/p1/0?v=0123456789abcdef')).toMatch(/\/public-image\/product\/p1\/0\?v=0123456789abcdef$/);
    expect(directImageSrc('javascript:alert(1)')).toBeNull();
    expect(directImageSrc('/etc/passwd')).toBeNull();
    expect(directImageSrc(null)).toBeNull();
  });
});
