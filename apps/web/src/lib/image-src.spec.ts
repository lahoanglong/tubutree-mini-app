import { describe, expect, it } from 'vitest';
import { sizedImage } from './image-src';

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
