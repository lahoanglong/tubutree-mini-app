import { isStorefrontImageValue } from './uploaded-image';

const PNG = `data:image/png;base64,${'A'.repeat(64)}`;

describe('isStorefrontImageValue', () => {
  it('nhận URL https (mọi host), ảnh raster base64 và chuỗi rỗng (xoá ảnh)', () => {
    expect(isStorefrontImageValue('https://res.cloudinary.com/x/a.jpg')).toBe(true);
    expect(isStorefrontImageValue('https://cdn.shop.vn/logo.png?v=2')).toBe(true);
    expect(isStorefrontImageValue(PNG)).toBe(true);
    expect(isStorefrontImageValue('')).toBe(true);
    expect(isStorefrontImageValue('   ')).toBe(true);
  });

  it.each([
    ['http thường', 'http://res.cloudinary.com/a.jpg'],
    ['địa chỉ nội bộ http', 'http://api:3001/health'],
    ['metadata đám mây', 'http://169.254.169.254/latest/meta-data'],
    ['https kèm user:pass', 'https://user:pw@cdn.shop.vn/a.jpg'],
    ['scheme lạ', 'javascript:alert(1)'],
    ['file', 'file:///etc/passwd'],
    ['đường dẫn tương đối', '/storefront/image/s1/avatar?v=1'],
    ['không phải URL', 'không phải url'],
    ['SVG base64', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['data HTML', 'data:text/html;base64,PGgxPmE8L2gxPg=='],
    ['quá dài', `https://cdn.shop.vn/${'a'.repeat(3000)}`],
  ])('từ chối %s', (_name, value) => {
    expect(isStorefrontImageValue(value)).toBe(false);
  });

  it('không phải chuỗi → false', () => {
    expect(isStorefrontImageValue(null)).toBe(false);
    expect(isStorefrontImageValue(123)).toBe(false);
  });
});
