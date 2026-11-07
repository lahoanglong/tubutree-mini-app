import { beforeEach, describe, expect, it } from 'vitest';
import type { IngredientLayerSprite } from '@tubutree/shared-types';
import { preloadImages, resetPreloadCache, storyPreloadUrls } from './story-preload';

const layer = (id: string, imageUrl?: string): IngredientLayerSprite => ({ id, label: id, from: 'top', xPct: 50, yPct: 50, scale: 1, rotateDeg: 0, ...(imageUrl ? { imageUrl } : { spriteId: 'water-droplet' }) });
const steps = [
  { layers: [layer('a', '/img/a.png')] },
  { layers: [layer('b', '/img/b.png'), layer('c'), layer('d', '/img/b.png'), layer('e', '/img/e.png')] },
  { layers: [layer('f', '/img/f.png')] },
];

describe('storyPreloadUrls: ảnh của bước kế tiếp', () => {
  it('bước 0 trả ảnh tải lên của bước 1, bỏ sprite vector và địa chỉ trùng', () => {
    expect(storyPreloadUrls(steps, 0)).toEqual(['/img/b.png', '/img/e.png']);
  });
  it('bước giữa trả bước sau nó, bước cuối không còn gì để tải', () => {
    expect(storyPreloadUrls(steps, 1)).toEqual(['/img/f.png']);
    expect(storyPreloadUrls(steps, 2)).toEqual([]);
  });
  it('chỉ số lạ được kẹp, không có bước thì rỗng', () => {
    expect(storyPreloadUrls(steps, -4)).toEqual(['/img/b.png', '/img/e.png']);
    expect(storyPreloadUrls(steps, 99)).toEqual([]);
    expect(storyPreloadUrls(steps, Number.NaN)).toEqual(['/img/b.png', '/img/e.png']);
    expect(storyPreloadUrls([], 0)).toEqual([]);
  });
  it('bước kế chỉ có sprite thư viện thì không có gì để tải', () => {
    expect(storyPreloadUrls([{ layers: [] }, { layers: [layer('x')] }], 0)).toEqual([]);
  });
});

describe('preloadImages: tải nền, mỗi địa chỉ một lần', () => {
  beforeEach(() => resetPreloadCache());
  const fake = () => {
    const made: { src: string; decoding: string; attrs: Record<string, string> }[] = [];
    const create = () => {
      const img = { src: '', decoding: '', attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { img.attrs[k] = v; } };
      made.push(img);
      return img;
    };
    return { made, create };
  };

  it('đặt decoding async, ưu tiên thấp, rồi gán src', () => {
    const { made, create } = fake();
    expect(preloadImages(['/img/b.png'], { create, saveData: false })).toBe(1);
    expect(made[0]).toMatchObject({ src: '/img/b.png', decoding: 'async', attrs: { fetchpriority: 'low' } });
  });
  it('gọi lại với cùng địa chỉ không tải lần hai', () => {
    const { made, create } = fake();
    preloadImages(['/img/b.png', '/img/e.png'], { create, saveData: false });
    expect(preloadImages(['/img/b.png', '/img/f.png'], { create, saveData: false })).toBe(1);
    expect(made.map((m) => m.src)).toEqual(['/img/b.png', '/img/e.png', '/img/f.png']);
  });
  it('tiết kiệm dữ liệu: không tải gì và không đánh dấu đã tải', () => {
    const { made, create } = fake();
    expect(preloadImages(['/img/b.png'], { create, saveData: true })).toBe(0);
    expect(made).toHaveLength(0);
    expect(preloadImages(['/img/b.png'], { create, saveData: false })).toBe(1);
  });
  it('môi trường không có Image (node, SSR) thì bỏ qua, không ném lỗi', () => {
    expect(preloadImages(['/img/b.png'], { saveData: false })).toBe(0);
  });
  it('danh sách rỗng hoặc địa chỉ rỗng không tạo ảnh', () => {
    const { made, create } = fake();
    expect(preloadImages([], { create, saveData: false })).toBe(0);
    expect(preloadImages([''], { create, saveData: false })).toBe(0);
    expect(made).toHaveLength(0);
  });
});
