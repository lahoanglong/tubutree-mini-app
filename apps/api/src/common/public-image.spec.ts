import { publicImage, publicImageRef, publicImages, publicProductThumb, storedThumbnailFor } from './public-image';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz4=';

describe('public-image', () => {
  it('link thường và tham chiếu có sẵn giữ nguyên; rỗng thành null', () => {
    expect(publicImage('product', 'p1', 'thumb', 'https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(publicImage('product', 'p1', 'thumb', '/public-image/product/p1/0?v=abc')).toBe('/public-image/product/p1/0?v=abc');
    expect(publicImage('product', 'p1', 'thumb', '')).toBeNull();
    expect(publicImage('product', 'p1', 'thumb', null)).toBeNull();
  });

  it('ảnh base64 thành đường dẫn có mã phiên bản theo nội dung; không còn data:', () => {
    const ref = publicImage('product', 'p1', 0, PNG)!;
    expect(ref).toMatch(/^\/public-image\/product\/p1\/0\?v=[0-9a-f]{16}$/);
    expect(ref).not.toContain('data:');
    expect(publicImageRef('product', 'p1', 0, PNG + 'x')).not.toBe(ref);
    expect(publicImageRef('product', 'p2', 0, PNG)).not.toBe(ref);
  });

  it('data URL không phục vụ được (SVG) bị bỏ, không lọt ra công khai', () => {
    expect(publicImage('brand', 'b1', 'logo', SVG)).toBeNull();
    expect(publicImages('product', 'p1', ['https://x/a.jpg', SVG, PNG])).toEqual(['https://x/a.jpg', expect.stringContaining('/public-image/product/p1/2?v=')]);
  });

  it('thẻ sản phẩm: thumbnail, không có thì ảnh đầu; đều không chứa base64', () => {
    expect(publicProductThumb({ id: 'p1', thumbnail: PNG, images: [] })).toContain('/public-image/product/p1/thumb');
    expect(publicProductThumb({ id: 'p1', thumbnail: null, images: [PNG] })).toContain('/public-image/product/p1/0');
    expect(publicProductThumb({ id: 'p1', thumbnail: null, images: [] })).toBeNull();
  });

  it('thumbnail lưu sẵn: ảnh đầu base64 thì lưu tham chiếu (không nhân đôi), link thì giữ link', () => {
    expect(storedThumbnailFor('p1', PNG)).toBe(publicImageRef('product', 'p1', 0, PNG));
    expect(storedThumbnailFor('p1', 'https://x/a.jpg')).toBe('https://x/a.jpg');
    expect(storedThumbnailFor('p1', undefined)).toBeNull();
  });
});
