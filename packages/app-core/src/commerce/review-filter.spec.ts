import { describe, expect, it } from 'vitest';
import { filterReviews, reviewFilterChips } from './review-filter';

const r = (id: string, rating: number, over: Partial<{ images: string[]; videoUrl: string | null }> = {}) => ({ id, rating, images: [] as string[], videoUrl: null as string | null, ...over });

describe('reviewFilterChips', () => {
  it('không có video thì bảy chip: Tất cả, đủ năm mức sao từ 5 xuống 1, Có ảnh', () => {
    const labels = ['Tất cả', '5 sao', '4 sao', '3 sao', '2 sao', '1 sao', 'Có ảnh'];
    expect(reviewFilterChips(0).map((c) => c.label)).toEqual(labels);
    expect(reviewFilterChips(undefined).map((c) => c.label)).toEqual(labels);
  });

  it('khoá lọc của chip sao là chính số sao, 2 và 1 sao không bị bỏ sót', () => {
    expect(reviewFilterChips(0).filter((c) => typeof c.key === 'number').map((c) => c.key)).toEqual([5, 4, 3, 2, 1]);
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

  it('lọc 2 sao và 1 sao lấy đúng đánh giá thấp, không lẫn mức khác', () => {
    const low = [r('a', 5), r('b', 2), r('c', 1), r('d', 2), r('e', 3)];
    expect(filterReviews(low, 2).map((x) => x.id)).toEqual(['b', 'd']);
    expect(filterReviews(low, 1).map((x) => x.id)).toEqual(['c']);
    expect(filterReviews([r('a', 5)], 1)).toEqual([]);
  });

  it('"photo" chỉ lấy đánh giá có ảnh, "video" chỉ lấy đánh giá có video', () => {
    expect(filterReviews(items, 'photo').map((x) => x.id)).toEqual(['a']);
    expect(filterReviews(items, 'video').map((x) => x.id)).toEqual(['c']);
  });
});
