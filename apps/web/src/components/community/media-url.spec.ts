import { describe, expect, it } from 'vitest';
import { timeAgo, safeMediaUrl } from './post-parts';

describe('timeAgo', () => {
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  it('chia theo phút, giờ, ngày như Mini App', () => {
    expect(timeAgo(ago(10))).toBe('vừa xong');
    expect(timeAgo(ago(5 * 60))).toBe('5 phút trước');
    expect(timeAgo(ago(3 * 3600))).toBe('3 giờ trước');
    expect(timeAgo(ago(2 * 86400))).toBe('2 ngày trước');
  });
});

describe('safeMediaUrl — nội dung người dùng tự nhập không được thành nguồn ảnh nguy hiểm', () => {
  it('URL https/http và data ảnh giữ nguyên', () => {
    expect(safeMediaUrl('https://res.cloudinary.com/demo/a.jpg')).toBe('https://res.cloudinary.com/demo/a.jpg');
    expect(safeMediaUrl('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
  });
  it('đường dẫn tương đối của API được ghép với gốc API công khai', () => {
    expect(safeMediaUrl('/feed/p1/images/0?v=1')).toMatch(/^https?:\/\/.+\/feed\/p1\/images\/0\?v=1$/);
  });
  it('javascript:, data không phải ảnh, "//host" và rỗng bị bỏ', () => {
    expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
    expect(safeMediaUrl('data:text/html;base64,AAAA')).toBeNull();
    expect(safeMediaUrl('//evil.test/x.png')).toBeNull();
    expect(safeMediaUrl('')).toBeNull();
    expect(safeMediaUrl(null)).toBeNull();
  });
});
