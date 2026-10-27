import { describe, expect, it } from 'vitest';
import { resolveServedMedia } from './served-media';

describe('resolveServedMedia', () => {
  it('ghép gốc API vào mọi chuỗi /public-image/ ở mọi độ sâu, bỏ dấu / thừa ở cuối gốc', () => {
    const json = { data: [{ thumbnail: '/public-image/product/p1/thumb?v=a', images: ['/public-image/product/p1/0?v=a', 'https://cdn/x.jpg'] }], brand: { logoUrl: '/public-image/brand/b/logo?v=b' } };
    expect(resolveServedMedia(json, 'https://api.tubutree.com/api/')).toEqual({
      data: [{ thumbnail: 'https://api.tubutree.com/api/public-image/product/p1/thumb?v=a', images: ['https://api.tubutree.com/api/public-image/product/p1/0?v=a', 'https://cdn/x.jpg'] }],
      brand: { logoUrl: 'https://api.tubutree.com/api/public-image/brand/b/logo?v=b' },
    });
  });

  it('chuỗi khác, số, null, đường dẫn tương đối khác giữ nguyên', () => {
    const json = { a: '/reviews/1/images/0?v=x', b: 3, c: null, d: 'public-image/x', e: '//host/public-image/x' };
    expect(resolveServedMedia(structuredClone(json), 'https://api/api')).toEqual(json);
    expect(resolveServedMedia('/public-image/a', 'https://api')).toBe('https://api/public-image/a');
    expect(resolveServedMedia(null, 'https://api')).toBeNull();
  });
});
