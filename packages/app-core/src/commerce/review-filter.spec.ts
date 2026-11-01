import { describe, expect, it } from 'vitest';
import { filterReviews, reviewFilterChips } from './review-filter';

const r = (id: string, rating: number, over: Partial<{ images: string[]; videoUrl: string | null }> = {}) => ({ id, rating, images: [] as string[], videoUrl: null as string | null, ...over });

describe('reviewFilterChips', () => {
  it('không có video thì năm chip: Tất cả, 5 sao, 4 sao, 3 sao, Có ảnh', () => {
    expect(reviewFilterChips(0).map((c) => c.label)).toEqual(['Tất cả', '5 sao', '4 sao', '3 sao', 'Có ảnh']);
    expect(reviewFilterChips(undefined).map((c) => c.label)).toEqual(['Tất cả', '5 sao', '4 sao', '3 sao', 'Có ảnh']);
  });

  it('có video thì thêm chip "Có video" kèm số lượng ở cuối', () => {
    expect(reviewFilterChips(2).at(-1)).toEqual({ key: 'video', label: 'Có video', count: 2 });
  });
});

describe('filterReviews', () => {
  const items = [r('a', 5, { images: ['x.jpg'] }), r('b', 4), r('c', 5, { videoUrl: 'v.mp4' }), r('d', 3)];

  it('"all" trả đủ, không đổi mảng gốc', () => {
    const out = filterReviews(items, 'all');
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out).not.toBe(items);
  });

  it('số sao chỉ lấy đúng mức sao', () => {
    expect(filterReviews(items, 5).map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterReviews(items, 3).map((x) => x.id)).toEqual(['d']);
  });

  it('"photo" chỉ lấy đánh giá có ảnh, "video" chỉ lấy đánh giá có video', () => {
    expect(filterReviews(items, 'photo').map((x) => x.id)).toEqual(['a']);
    expect(filterReviews(items, 'video').map((x) => x.id)).toEqual(['c']);
  });
});
