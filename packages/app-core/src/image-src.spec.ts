import { describe, expect, it } from 'vitest';
import { imageVariants, pickImageWidth } from './image-src';

const API = 'https://api.tubutree.com/api';
const decode = (url: string) => new URL(url).searchParams.get('u');

describe('pickImageWidth', () => {
  it('bề rộng nhỏ nhất đủ dùng, tối đa 960', () => {
    expect([100, 160, 161, 340, 400, 640, 641, 2000].map(pickImageWidth)).toEqual([160, 160, 320, 640, 640, 640, 960, 960]);
  });
});

describe('imageVariants', () => {
  it('thẻ SP 170px: 1x = 320, 2x = 640, kèm srcset', () => {
    const v = imageVariants('https://content.pancake.vn/2-26/a.jpg', 170, API)!;
    expect(v.src).toBe(`${API}/img?w=320&u=${encodeURIComponent('https://content.pancake.vn/2-26/a.jpg')}`);
    expect(v.srcSet).toBe(`${v.src} 1x, ${API}/img?w=640&u=${encodeURIComponent('https://content.pancake.vn/2-26/a.jpg')} 2x`);
  });

  it('ô nhỏ 64px: 1x và 2x cùng 160 thì không có srcset', () => {
    const v = imageVariants('https://res.cloudinary.com/x/image/upload/a.png', 64, API)!;
    expect(v.src).toContain('w=160');
    expect(v.srcSet).toBeUndefined();
  });

  it('ảnh lớn ở chi tiết SP: 2x bị chặn ở 960', () => {
    const v = imageVariants('https://content.pancake.vn/a.jpg', 600, API)!;
    expect(v.srcSet).toContain('w=640');
    expect(v.srcSet).toContain('w=960');
  });

  it('ảnh của chính API (đã ghép địa chỉ đầy đủ hoặc còn tương đối) gửi dưới dạng đường dẫn /public-image', () => {
    const own = '/public-image/product/abc123/thumb?v=0123abcd';
    expect(decode(imageVariants(`${API}${own}`, 170, API)!.src)).toBe(own);
    expect(decode(imageVariants(own, 170, API)!.src)).toBe(own);
  });

  it('không đổi cỡ: host lạ, http thường, base64, ảnh API sai dạng, thiếu địa chỉ API, chiều rộng không hợp lệ', () => {
    expect(imageVariants('https://evil.example.com/a.jpg', 170, API)).toBeNull();
    expect(imageVariants('http://content.pancake.vn/a.jpg', 170, API)).toBeNull();
    expect(imageVariants('data:image/png;base64,AAAA', 170, API)).toBeNull();
    expect(imageVariants(`${API}/public-image/../x`, 170, API)).toBeNull();
    expect(imageVariants('https://other.com/api/public-image/product/a/0', 170, API)).toBeNull();
    expect(imageVariants('https://content.pancake.vn/a.jpg', 170, '')).toBeNull();
    expect(imageVariants('https://content.pancake.vn/a.jpg', 0, API)).toBeNull();
    expect(imageVariants(null, 170, API)).toBeNull();
  });
});
