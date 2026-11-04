import { describe, expect, it } from 'vitest';
import { safeImageUrl } from './safe-image-url';

describe('safeImageUrl', () => {
  it('cho qua https của host ảnh đã biết và ảnh raster base64', () => {
    expect(safeImageUrl('https://res.cloudinary.com/x/image/upload/a.jpg')).toBe('https://res.cloudinary.com/x/image/upload/a.jpg');
    expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImageUrl('data:image/jpeg;base64,/9j/4AAQ')).not.toBeNull();
    expect(safeImageUrl('data:image/webp;base64,UklGRg==')).not.toBeNull();
  });
  it('nhận đủ các dạng base64 mà API lưu cho ảnh nhân viên (STAFF_IMAGE): jpg và gif', () => {
    expect(safeImageUrl('data:image/jpg;base64,/9j/4AAQ')).not.toBeNull();
    expect(safeImageUrl('data:image/gif;base64,R0lGODlh')).not.toBeNull();
  });
  it('chặn javascript:, http://, host lạ, svg, data html, rỗng', () => {
    for (const bad of [
      'javascript:alert(1)',
      'http://res.cloudinary.com/a.jpg',
      'https://evil.example/a.jpg',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGI+',
      '/relative.png',
      '',
      ' https://res.cloudinary.com/a.jpg',
    ]) {
      expect(safeImageUrl(bad)).toBeNull();
    }
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
  });
});
