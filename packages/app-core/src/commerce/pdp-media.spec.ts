import { describe, expect, it } from 'vitest';
import { PDP_VIDEOS_MAX, pdpMedia, pdpMediaIndexOfImage, pdpVideoUrls } from './pdp-media';

describe('pdpVideoUrls', () => {
  it('chỉ nhận http(s), bỏ trùng, bỏ mục không phải chuỗi và scheme nguy hiểm', () => {
    expect(
      pdpVideoUrls(['https://c/a.mp4', 'http://c/b.mp4', 'https://c/a.mp4', 'javascript:alert(1)', 'data:video/mp4;base64,AAA', '/rel.mp4', '  ', 5, null, { url: 'https://c/x.mp4' }]),
    ).toEqual(['https://c/a.mp4', 'https://c/b.mp4']);
  });

  it('nâng http: thành https: và bỏ trùng sau khi nâng', () => {
    expect(pdpVideoUrls(['http://c/a.mp4', 'https://c/a.mp4', 'HTTP://c/b.mp4'])).toEqual(['https://c/a.mp4', 'https://c/b.mp4']);
  });

  it('thiếu hoặc không phải mảng (API cũ) → không video', () => {
    expect(pdpVideoUrls(undefined)).toEqual([]);
    expect(pdpVideoUrls(null)).toEqual([]);
    expect(pdpVideoUrls('https://c/a.mp4' as unknown as string[])).toEqual([]);
  });

  it(`tối đa ${PDP_VIDEOS_MAX}`, () => {
    expect(pdpVideoUrls(Array.from({ length: 20 }, (_, i) => `https://c/${i}.mp4`))).toHaveLength(PDP_VIDEOS_MAX);
  });
});

describe('pdpMedia', () => {
  it('ảnh trước, video sau; poster của video là ảnh đầu', () => {
    expect(pdpMedia(['https://i/a.jpg', 'https://i/b.jpg'], ['https://c/v.mp4'])).toEqual([
      { kind: 'image', src: 'https://i/a.jpg' },
      { kind: 'image', src: 'https://i/b.jpg' },
      { kind: 'video', src: 'https://c/v.mp4', poster: 'https://i/a.jpg' },
    ]);
  });

  it('không ảnh: video vẫn có ô, không poster', () => {
    expect(pdpMedia([], ['https://c/v.mp4'])).toEqual([{ kind: 'video', src: 'https://c/v.mp4', poster: null }]);
  });

  it('không video: chỉ ảnh, như trước W181', () => {
    expect(pdpMedia(['https://i/a.jpg'], undefined)).toEqual([{ kind: 'image', src: 'https://i/a.jpg' }]);
  });
});

describe('pdpMediaIndexOfImage', () => {
  const media = pdpMedia(['https://i/a.jpg', 'https://i/b.jpg'], ['https://i/b.jpg']);
  it('trả vị trí ô ảnh; ô video trùng URL không tính', () => {
    expect(pdpMediaIndexOfImage(media, 'https://i/b.jpg')).toBe(1);
  });
  it('không có ảnh riêng hoặc ảnh ngoài thư viện → -1', () => {
    expect(pdpMediaIndexOfImage(media, null)).toBe(-1);
    expect(pdpMediaIndexOfImage(media, undefined)).toBe(-1);
    expect(pdpMediaIndexOfImage(media, 'https://i/zzz.jpg')).toBe(-1);
  });
});
