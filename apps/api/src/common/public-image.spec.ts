import { isPublicImageKind, publicImage, publicImageRef, publicImages, publicProductThumb, storedThumbnailFor, storedThumbnailOf } from './public-image';

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

  it('thumbnail lưu sẵn: SVG (endpoint ảnh không phục vụ) giữ nguyên, không đổi thành đường dẫn 404', () => {
    expect(storedThumbnailFor('p1', SVG)).toBe(SVG);
    expect(storedThumbnailOf('p1', SVG, SVG, true)).toBe(SVG);
  });

  it('thumbnail của dữ liệu nhập tay: sản phẩm từng công khai thì trùng ảnh đầu thành đường dẫn, chưa từng công khai thì giữ data URL', () => {
    expect(storedThumbnailOf('p1', PNG, PNG, true)).toBe(publicImageRef('product', 'p1', 0, PNG));
    expect(storedThumbnailOf('p1', PNG, PNG, false)).toBe(PNG);
    expect(storedThumbnailOf('p1', null, PNG, true)).toBeNull();
    expect(storedThumbnailOf('p1', 'https://x/a.jpg', PNG, true)).toBe('https://x/a.jpg');
  });

  it('sản phẩm chưa công khai mà thumbnail còn là đường dẫn cũ tới ảnh đầu: trả lại chính ảnh đầu, không để đường dẫn 404', () => {
    const stale = publicImageRef('product', 'p1', 0, PNG);
    expect(storedThumbnailOf('p1', stale, PNG + '', false)).toBe(PNG);
    expect(storedThumbnailOf('p1', stale, undefined, false)).toBeNull();
    expect(storedThumbnailOf('p1', stale, PNG, true)).toBe(stale);
  });

  it('loại ảnh campaign hợp lệ, ảnh base64 của chiến dịch đi ra dạng đường dẫn cover', () => {
    expect(isPublicImageKind('campaign')).toBe(true);
    expect(publicImage('campaign', 'c1', 'cover', PNG)).toMatch(/^\/public-image\/campaign\/c1\/cover\?v=[0-9a-f]{16}$/);
  });
});
