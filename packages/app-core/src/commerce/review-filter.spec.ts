import { describe, expect, it } from 'vitest';
import { filterReviews, reviewFilterChips, reviewFilterQuery, reviewListKey, reviewListView } from './review-filter';

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

describe('reviewFilterQuery: bộ lọc gửi máy chủ (máy chủ lọc trên mọi đánh giá, không chỉ 100 dòng mới nhất)', () => {
  it('"all" không gửi tham số; chip sao gửi rating; Có ảnh/Có video gửi media', () => {
    expect(reviewFilterQuery('all')).toBe('');
    expect([5, 4, 3, 2, 1].map((k) => reviewFilterQuery(k))).toEqual(['?rating=5', '?rating=4', '?rating=3', '?rating=2', '?rating=1']);
    expect(reviewFilterQuery('photo')).toBe('?media=photo');
    expect(reviewFilterQuery('video')).toBe('?media=video');
  });

  it('mọi chip đang vẽ đều có tham số máy chủ nhận (rating 1..5, media photo/video)', () => {
    for (const chip of reviewFilterChips(3)) {
      const qs = reviewFilterQuery(chip.key);
      if (chip.key === 'all') expect(qs).toBe('');
      else expect(qs).toMatch(/^\?(rating=[1-5]|media=(photo|video))$/);
    }
  });

  it('số sao ngoài 1..5 hoặc không nguyên thì không gửi (máy chủ trả 400 cho giá trị đó)', () => {
    for (const k of [0, 6, 2.5, -1, Number.NaN]) expect(reviewFilterQuery(k)).toBe('');
  });
});

describe('reviewListKey: khoá cache danh sách theo bộ lọc', () => {
  it('"Tất cả" dùng chung khoá với dải Đánh giá nhanh; chip khác thêm khoá lọc phía sau (làm mới ["reviews", slug] làm mới cả chúng)', () => {
    expect(reviewListKey('nuoc-rua-chen', 'all')).toEqual(['reviews', 'nuoc-rua-chen']);
    expect(reviewListKey('nuoc-rua-chen', 1)).toEqual(['reviews', 'nuoc-rua-chen', 1]);
    expect(reviewListKey('nuoc-rua-chen', 'photo')).toEqual(['reviews', 'nuoc-rua-chen', 'photo']);
    expect(reviewListKey('a', 5)).not.toEqual(reviewListKey('a', 4));
  });
});

describe('reviewListView: danh sách hiển thị theo chip đang chọn', () => {
  const all = { data: { items: [r('a', 5), r('b', 5)] }, isPending: false, isError: false };
  const none = { data: undefined, isPending: true, isError: false };

  it('"Tất cả" lấy dòng của danh sách đầy đủ', () => {
    expect(reviewListView('all', all, none)).toEqual({ status: 'ready', items: all.data.items });
  });

  it('chip lọc đang chờ máy chủ: "loading", KHÔNG lọc tạm danh sách đầy đủ (tránh báo "không có đánh giá khớp" sai)', () => {
    expect(reviewListView(1, all, none)).toEqual({ status: 'loading', items: [] });
  });

  it('chip lọc có kết quả máy chủ: lấy đúng dòng máy chủ trả, kể cả khi danh sách đầy đủ không có dòng nào khớp', () => {
    const one = { data: { items: [r('z', 1)] }, isPending: false, isError: false };
    expect(reviewListView(1, all, one)).toEqual({ status: 'ready', items: one.data.items });
  });

  it('API cũ bỏ qua tham số lọc và trả cả danh sách: vẫn chỉ hiện dòng khớp chip', () => {
    const ignored = { data: { items: [r('a', 5), r('z', 1)] }, isPending: false, isError: false };
    expect(reviewListView(1, all, ignored).items.map((x) => x.id)).toEqual(['z']);
  });

  it('máy chủ trả rỗng: "ready" với danh sách rỗng (app vẽ "Không có đánh giá khớp bộ lọc.")', () => {
    expect(reviewListView(3, all, { data: { items: [] }, isPending: false, isError: false })).toEqual({ status: 'ready', items: [] });
  });

  it('lỗi tải chip lọc mà chưa có dữ liệu: "error"; đã có dữ liệu cũ thì vẫn hiện dữ liệu đó', () => {
    expect(reviewListView('photo', all, { data: undefined, isPending: false, isError: true })).toEqual({ status: 'error', items: [] });
    const stale = { data: { items: [r('p', 4, { images: ['x.jpg'] })] }, isPending: false, isError: true };
    expect(reviewListView('photo', all, stale)).toEqual({ status: 'ready', items: stale.data.items });
  });
});
