import { cacheKey, isAllowedWidth, isPrivateAddress, negotiateFormat, parseOwnImagePath, parseRemoteSource } from './image-resize';

describe('parseRemoteSource (chống SSRF)', () => {
  it('nhận ảnh https trên Pancake CDN và Cloudinary', () => {
    expect(parseRemoteSource('https://content.pancake.vn/2-26/s800x800/a.jpg')?.hostname).toBe('content.pancake.vn');
    expect(parseRemoteSource('https://res.cloudinary.com/demo/image/upload/v1/x.png')?.hostname).toBe('res.cloudinary.com');
  });

  it('host lạ, host nhái, http, user:pass, cổng, IP, không phải chuỗi → null', () => {
    for (const bad of [
      'https://evil.example.com/a.jpg',
      'https://content.pancake.vn.evil.com/a.jpg',
      'https://evil.com/?https://content.pancake.vn/a.jpg',
      'https://content.pancake.vn@evil.com/a.jpg',
      'http://content.pancake.vn/a.jpg',
      'https://user:pw@content.pancake.vn/a.jpg',
      'https://content.pancake.vn:8443/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.jpg',
      'file:///etc/passwd',
      '//content.pancake.vn/a.jpg',
      '',
      'x'.repeat(1001),
    ]) {
      expect(parseRemoteSource(bad)).toBeNull();
    }
    expect(parseRemoteSource(undefined)).toBeNull();
    expect(parseRemoteSource(['https://content.pancake.vn/a.jpg'])).toBeNull();
  });

  it('host thêm qua danh sách cấu hình', () => {
    expect(parseRemoteSource('https://img.tubutree.com/a.jpg')).toBeNull();
    expect(parseRemoteSource('https://img.tubutree.com/a.jpg', ['img.tubutree.com'])?.hostname).toBe('img.tubutree.com');
  });
});

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'khong-phai-ip'])(
    '%s là nội bộ',
    (a) => expect(isPrivateAddress(a)).toBe(true),
  );
  it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s là công cộng', (a) => expect(isPrivateAddress(a)).toBe(false));
});

describe('parseOwnImagePath', () => {
  it('nhận đường dẫn ảnh của chính API, không nhận gì khác', () => {
    expect(parseOwnImagePath('/public-image/product/abc123/thumb?v=0123abcd')).toEqual({ kind: 'product', id: 'abc123', slot: 'thumb', version: '0123abcd' });
    expect(parseOwnImagePath('/public-image/product/abc123/2')).toEqual({ kind: 'product', id: 'abc123', slot: '2', version: undefined });
    expect(parseOwnImagePath('/public-image/../../etc/passwd')).toBeNull();
    expect(parseOwnImagePath('/other/product/a/0')).toBeNull();
    expect(parseOwnImagePath('http://localhost:3001/api/public-image/product/a/0')).toBeNull();
  });
});

describe('width, định dạng, khoá cache', () => {
  it('chỉ bốn bề rộng cố định', () => {
    expect([160, 320, 640, 960].every(isAllowedWidth)).toBe(true);
    expect([0, 100, 161, 1200, NaN].some(isAllowedWidth)).toBe(false);
  });
  it('webp khi trình duyệt nhận, không thì jpeg', () => {
    expect(negotiateFormat('image/avif,image/webp,*/*')).toBe('webp');
    expect(negotiateFormat('image/png,*/*')).toBe('jpeg');
    expect(negotiateFormat(undefined)).toBe('jpeg');
  });
  it('khoá cache ổn định và khác nhau theo nguồn, bề rộng, định dạng', () => {
    const k = cacheKey('https://a/x.jpg', 320, 'webp');
    expect(k).toBe(cacheKey('https://a/x.jpg', 320, 'webp'));
    expect(new Set([k, cacheKey('https://a/y.jpg', 320, 'webp'), cacheKey('https://a/x.jpg', 640, 'webp'), cacheKey('https://a/x.jpg', 320, 'jpeg')]).size).toBe(4);
  });
});
