import { publicStorefrontImage, storefrontImageRef, storefrontImageVersion } from './storefront-images';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('ảnh gian hàng phục vụ qua endpoint ảnh (D3-10)', () => {
  it('mã phiên bản đổi theo nội dung, theo loại ảnh và theo gian hàng', () => {
    const a = storefrontImageVersion('s1', 'avatar', PNG);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(storefrontImageVersion('s1', 'avatar', PNG)).toBe(a);
    expect(storefrontImageVersion('s1', 'avatar', `${PNG}A`)).not.toBe(a);
    expect(storefrontImageVersion('s1', 'cover', PNG)).not.toBe(a);
    expect(storefrontImageVersion('s2', 'avatar', PNG)).not.toBe(a);
  });

  it('đường dẫn tương đối API kèm mã v', () => {
    expect(storefrontImageRef('s1', 'cover', 'abc')).toBe('/storefront/image/s1/cover?v=abc');
  });

  it('URL https giữ nguyên, rỗng thành null', () => {
    expect(publicStorefrontImage('s1', 'avatar', 'https://res.cloudinary.com/x/a.jpg')).toBe('https://res.cloudinary.com/x/a.jpg');
    expect(publicStorefrontImage('s1', 'avatar', null)).toBeNull();
    expect(publicStorefrontImage('s1', 'avatar', '')).toBeNull();
  });

  it('ảnh raster base64 thành đường dẫn tới endpoint ảnh, JSON không còn nội dung ảnh', () => {
    const out = publicStorefrontImage('s1', 'avatar', PNG)!;
    expect(out).toBe(`/storefront/image/s1/avatar?v=${storefrontImageVersion('s1', 'avatar', PNG)}`);
    expect(out).not.toContain('base64');
  });

  it('data URL không phục vụ được (SVG, HTML, base64 hỏng) không được trả ra', () => {
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'data:image/png;base64,@@@']) {
      expect(publicStorefrontImage('s1', 'cover', bad)).toBeNull();
    }
  });
});
