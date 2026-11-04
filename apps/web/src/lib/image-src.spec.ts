// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fallBackToOriginal, isUploadedImage, sizedImage } from './image-src';

const PANCAKE = 'https://content.pancake.vn/2-26/s800x800/a.jpg';
const widthsOf = (srcSet: string | undefined) => (srcSet ?? '').split(', ').map((e) => e.split(' ')[1]);

describe('sizedImage: srcset theo bề rộng (Pa1)', () => {
  it('ảnh Pancake: mô tả w trên 160/320/640/960, không có mô tả 1x/2x', () => {
    const img = sizedImage(PANCAKE, 360, '50vw');
    expect(widthsOf(img.srcSet)).toEqual(['160w', '320w', '640w', '960w']);
    expect(img.srcSet).not.toMatch(/\dx(,|$)/);
    expect(img.sizes).toBe('50vw');
  });

  it('ô nhỏ (64px) chỉ cần tới bản 320 (3x không quá 192px)', () => {
    expect(widthsOf(sizedImage(PANCAKE, 64, '64px').srcSet)).toEqual(['160w', '320w']);
  });

  it('thiếu sizes thì lấy đúng cssWidth', () => {
    expect(sizedImage(PANCAKE, 148).sizes).toBe('148px');
  });

  it('host lạ hoặc base64: nguyên ảnh gốc, không srcset/sizes', () => {
    expect(sizedImage('https://img.test/a.jpg', 300)).toEqual({ src: 'https://img.test/a.jpg' });
    expect(sizedImage('data:image/png;base64,AAAA', 300)).toEqual({ src: 'data:image/png;base64,AAAA' });
  });

  it('src (khi trình duyệt không hiểu srcset) là bản đủ cho cssWidth', () => {
    expect(sizedImage(PANCAKE, 360).src).toContain('/img?w=640&u=');
  });
});

describe('sizedImage: bản 1280/1920 đã đổi cỡ cho banner/hero (màn 2x–3x không mờ, không tải ảnh gốc)', () => {
  it('wide thêm w=1280 và w=1920 qua bộ đổi cỡ sau 960w; mặc định không thêm', () => {
    const img = sizedImage(PANCAKE, 728, '728px', true);
    expect(widthsOf(img.srcSet)).toEqual(['160w', '320w', '640w', '960w', '1280w', '1920w']);
    const entries = img.srcSet!.split(', ');
    expect(entries.at(-2)).toContain('/img?w=1280&u=');
    expect(entries.at(-1)).toContain('/img?w=1920&u=');
    expect(img.srcSet).not.toContain(`${PANCAKE} `);
    expect(widthsOf(sizedImage(PANCAKE, 728).srcSet)).toEqual(['160w', '320w', '640w', '960w']);
  });

  it('host lạ vẫn chỉ có URL gốc, không srcset', () => {
    expect(sizedImage('https://img.test/a.jpg', 728, '728px', true)).toEqual({ src: 'https://img.test/a.jpg' });
  });
});

describe('fallBackToOriginal: bộ đổi cỡ lỗi thì lùi về ảnh gốc đúng một lần', () => {
  it('lần lỗi đầu đổi src về gốc và bỏ srcset/sizes; lần lỗi sau (gốc cũng hỏng) để yên', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'http://api/img?w=160&u=x');
    img.setAttribute('srcset', 'a 160w');
    img.setAttribute('sizes', '50vw');
    const handler = fallBackToOriginal('https://orig/a.jpg');
    handler({ currentTarget: img });
    expect(img.getAttribute('src')).toBe('https://orig/a.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.hasAttribute('sizes')).toBe(false);
    expect(img.dataset.fellBack).toBe('1');
    img.setAttribute('src', 'https://orig/other.jpg');
    handler({ currentTarget: img });
    expect(img.getAttribute('src')).toBe('https://orig/other.jpg');
  });
});

describe('isUploadedImage / uploadedOnly: chỉ ảnh có trong danh sách /img của gian hàng và chiến dịch', () => {
  const CLOUD = 'https://res.cloudinary.com/tubutree/image/upload/v1/a.jpg';
  it('Cloudinary và ảnh của API: có; Pancake, host lạ, base64, rác: không', () => {
    expect(isUploadedImage(CLOUD)).toBe(true);
    expect(isUploadedImage('/public-image/campaign/c1/cover?v=abc')).toBe(true);
    for (const s of [PANCAKE, 'https://evil.example/a.jpg', 'data:image/png;base64,AAAA', 'not a url', '']) expect(isUploadedImage(s)).toBe(false);
  });

  it('uploadedOnly: Pancake giữ URL gốc dù resizer đổi cỡ được; Cloudinary vẫn có srcset', () => {
    expect(sizedImage(PANCAKE, 728, '728px', true, true)).toEqual({ src: PANCAKE });
    expect(sizedImage(CLOUD, 728, '728px', true, true).srcSet).toContain('1920w');
    expect(sizedImage(PANCAKE, 728, '728px', true).srcSet).toContain('1920w');
  });
});
