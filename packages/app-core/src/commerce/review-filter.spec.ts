import { describe, expect, it } from 'vitest';
import {
  REVIEW_STEP,
  filterReviews,
  reviewFilterChips,
  reviewFilterQuery,
  reviewHasMore,
  reviewListKey,
  reviewListView,
  reviewMoreKey,
  reviewMorePrefix,
  reviewMoreStep,
} from './review-filter';
import { fillCopy } from '../shop-copy';

const r = (id: string, rating: number, over: Partial<{ images: string[]; videoUrl: string | null }> = {}) => ({ id, rating, images: [] as string[], videoUrl: null as string | null, ...over });

describe('reviewFilterChips', () => {
  it('không có video thì bảy chip: Tất cả, đủ năm mức sao từ 5 xuống 1, Có ảnh', () => {
    const labels = ['Tất cả', '5 sao', '4 sao', '3 sao', '2 sao', '1 sao', 'Có ảnh'];
    expect(reviewFilterChips({ videoCount: 0 }).map((c) => c.label)).toEqual(labels);
    expect(reviewFilterChips(undefined).map((c) => c.label)).toEqual(labels);
  });

  it('khoá lọc của chip sao là chính số sao, 2 và 1 sao không bị bỏ sót', () => {
    expect(reviewFilterChips({ videoCount: 0 }).filter((c) => typeof c.key === 'number').map((c) => c.key)).toEqual([5, 4, 3, 2, 1]);
  });

  it('có video thì thêm chip "Có video" kèm số lượng ở cuối', () => {
    expect(reviewFilterChips({ videoCount: 2 }).at(-1)).toEqual({ key: 'video', label: 'Có video', count: 2 });
  });

  // W30: khách đang xem "Có video" mà đánh giá video cuối cùng bị ẩn (danh sách đầy đủ tải lại, videoCount về 0): chip không được biến mất dưới tay khách,
  // nếu không danh sách trống báo "không có đánh giá khớp" mà không chip nào đang chọn.
  it('đang chọn "Có video" mà số video về 0: chip vẫn còn, đang chọn, ghi (0)', () => {
    expect(reviewFilterChips({ videoCount: 0 }, 'video').at(-1)).toEqual({ key: 'video', label: 'Có video', count: 0 });
    expect(reviewFilterChips(undefined, 'video').at(-1)).toEqual({ key: 'video', label: 'Có video', count: 0 });
  });

  it('chọn chip khác thì chip "Có video" vẫn chỉ hiện khi có video', () => {
    for (const sel of ['all', 'photo', 5, 1] as const) {
      expect(reviewFilterChips({ videoCount: 0 }, sel).some((c) => c.key === 'video')).toBe(false);
      expect(reviewFilterChips({ videoCount: 3 }, sel).at(-1)).toEqual({ key: 'video', label: 'Có video', count: 3 });
    }
  });

  // W35: sản phẩm hơn 100 đánh giá: trang đầu chỉ có 100 dòng mới nhất, số đếm trên chip phải là số của máy chủ trên mọi đánh giá đang hiện.
  it('số đếm trên chip Tất cả, 5..1 sao, Có video lấy từ máy chủ (count, distribution, videoCount), không đếm trên 100 dòng đã tải', () => {
    const items = Array.from({ length: 100 }, (_, i) => r(`m${i}`, 5));
    const chips = reviewFilterChips({ count: 123, distribution: { '5': 120, '1': 3 }, videoCount: 2, items });
    expect(chips.map((c) => [c.key, c.count])).toEqual([
      ['all', 123],
      [5, 120],
      [4, 0],
      [3, 0],
      [2, 0],
      [1, 3],
      ['photo', undefined],
      ['video', 2],
    ]);
  });

  it('API cũ chưa trả số đếm: đếm trên các đánh giá đã tải', () => {
    const items = [r('a', 5), r('b', 5, { videoUrl: 'v.mp4' }), r('c', 1), r('d', 4, { images: ['x.jpg'] })];
    const chips = reviewFilterChips({ items });
    expect(chips.map((c) => [c.key, c.count])).toEqual([
      ['all', 4],
      [5, 2],
      [4, 1],
      [3, 0],
      [2, 0],
      [1, 1],
      ['photo', undefined],
      ['video', 1],
    ]);
  });

  it('máy chủ trả tổng nhưng thiếu phân bố sao: Tất cả theo máy chủ, chip sao đếm trên các đánh giá đã tải', () => {
    const chips = reviewFilterChips({ count: 50, videoCount: 0, items: [r('a', 5), r('b', 3)] });
    expect(chips.find((c) => c.key === 'all')?.count).toBe(50);
    expect(chips.find((c) => c.key === 5)?.count).toBe(1);
    expect(chips.find((c) => c.key === 3)?.count).toBe(1);
    expect(chips.some((c) => c.key === 'video')).toBe(false);
  });

  it('chưa có dữ liệu (đang tải): chip không ghi số nào', () => {
    expect(reviewFilterChips(undefined).every((c) => c.count === undefined)).toBe(true);
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
  it('"all" không gửi tham số; chip sao gửi rating; Có ảnh gửi media=photo; Có video gửi hasVideo=true (W35)', () => {
    expect(reviewFilterQuery('all')).toBe('');
    expect([5, 4, 3, 2, 1].map((k) => reviewFilterQuery(k))).toEqual(['?rating=5', '?rating=4', '?rating=3', '?rating=2', '?rating=1']);
    expect(reviewFilterQuery('photo')).toBe('?media=photo');
    expect(reviewFilterQuery('video')).toBe('?hasVideo=true');
  });

  it('mọi chip đang vẽ đều có tham số máy chủ nhận (rating 1..5, media=photo, hasVideo=true)', () => {
    for (const chip of reviewFilterChips({ videoCount: 3 })) {
      const qs = reviewFilterQuery(chip.key);
      if (chip.key === 'all') expect(qs).toBe('');
      else expect(qs).toMatch(/^\?(rating=[1-5]|media=photo|hasVideo=true)$/);
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
    expect(reviewListView('all', all, none)).toEqual({ status: 'ready', items: all.data.items, hasMore: false, more: 'idle' });
  });

  it('chip lọc đang chờ máy chủ: "loading", KHÔNG lọc tạm danh sách đầy đủ (tránh báo "không có đánh giá khớp" sai)', () => {
    expect(reviewListView(1, all, none)).toEqual({ status: 'loading', items: [], hasMore: false, more: 'idle' });
  });

  it('chip lọc có kết quả máy chủ: lấy đúng dòng máy chủ trả, kể cả khi danh sách đầy đủ không có dòng nào khớp', () => {
    const one = { data: { items: [r('z', 1)] }, isPending: false, isError: false };
    expect(reviewListView(1, all, one)).toEqual({ status: 'ready', items: one.data.items, hasMore: false, more: 'idle' });
  });

  it('API cũ bỏ qua tham số lọc và trả cả danh sách: vẫn chỉ hiện dòng khớp chip', () => {
    const ignored = { data: { items: [r('a', 5), r('z', 1)] }, isPending: false, isError: false };
    expect(reviewListView(1, all, ignored).items.map((x) => x.id)).toEqual(['z']);
  });

  it('máy chủ trả rỗng: "ready" với danh sách rỗng (app vẽ "Không có đánh giá khớp bộ lọc.")', () => {
    expect(reviewListView(3, all, { data: { items: [] }, isPending: false, isError: false })).toEqual({ status: 'ready', items: [], hasMore: false, more: 'idle' });
  });

  it('lỗi tải chip lọc mà chưa có dữ liệu: "error"; đã có dữ liệu cũ thì vẫn hiện dữ liệu đó', () => {
    expect(reviewListView('photo', all, { data: undefined, isPending: false, isError: true })).toEqual({ status: 'error', items: [], hasMore: false, more: 'idle' });
    const stale = { data: { items: [r('p', 4, { images: ['x.jpg'] })] }, isPending: false, isError: true };
    expect(reviewListView('photo', all, stale)).toEqual({ status: 'ready', items: stale.data.items, hasMore: false, more: 'idle' });
  });
});

// Sản phẩm hơn 100 đánh giá: trang đầu kèm nextCursor, bấm "Xem thêm đánh giá" tải trang kế nối vào cuối; đổi chip về trang đầu.
describe('phân trang: trang đầu + các trang tải thêm', () => {
  const page = (ids: string[], nextCursor: string | null = null, rating = 5) => ({ items: ids.map((id) => r(id, rating)), nextCursor });
  const src = (data: ReturnType<typeof page> | undefined) => ({ data, isPending: !data, isError: false });
  const none = src(undefined);

  it('reviewFilterQuery kèm cursor: nối sau bộ lọc, mã hoá URL; không cursor thì như cũ', () => {
    expect(reviewFilterQuery('all', 'MTc2|r99')).toBe('?cursor=MTc2%7Cr99');
    expect(reviewFilterQuery(1, 'abc')).toBe('?rating=1&cursor=abc');
    expect(reviewFilterQuery('photo', 'abc')).toBe('?media=photo&cursor=abc');
    expect(reviewFilterQuery('video', null)).toBe('?hasVideo=true');
    expect(reviewFilterQuery('video', 'abc')).toBe('?hasVideo=true&cursor=abc');
    expect(reviewFilterQuery(5, '')).toBe('?rating=5');
    expect(reviewFilterQuery(0, 'abc')).toBe('?cursor=abc');
  });

  it('khoá trang tải thêm: dưới ["reviews", slug] (làm mới sau khi viết đánh giá), tách theo chip và con trỏ trang đầu', () => {
    expect(reviewMoreKey('sp', 'all', 'c1')).toEqual(['reviews', 'sp', 'more', 'all', 'c1']);
    expect(reviewMoreKey('sp', 'all', 'c1').slice(0, 3)).toEqual(reviewMorePrefix('sp'));
    expect(reviewMoreKey('sp', 1, 'c1')).not.toEqual(reviewMoreKey('sp', 'all', 'c1'));
    expect(reviewMoreKey('sp', 'all', 'c2')).not.toEqual(reviewMoreKey('sp', 'all', 'c1'));
    for (const chip of reviewFilterChips({ videoCount: 3 })) expect(reviewListKey('sp', chip.key)).not.toEqual(reviewMorePrefix('sp'));
  });

  it('trang đầu có nextCursor: hasMore; chưa tải thêm thì chỉ dòng trang đầu', () => {
    const v = reviewListView('all', src(page(['a', 'b'], 'c1')), none);
    expect(v).toMatchObject({ status: 'ready', hasMore: true, more: 'idle' });
    expect(v.items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('nối trang tải thêm vào cuối theo thứ tự, giữ nguyên dòng trang đầu; hasMore theo trang cuối', () => {
    const more = { pages: [page(['c', 'd'], 'c2'), page(['e'], null)], isFetching: false, isError: false };
    const v = reviewListView('all', src(page(['a', 'b'], 'c1')), none, more);
    expect(v.items.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(v.hasMore).toBe(false);
    expect(reviewListView('all', src(page(['a'], 'c1')), none, { ...more, pages: [page(['c'], 'c2')] }).hasMore).toBe(true);
  });

  it('dòng trùng id giữa hai trang (đánh giá mới chen vào lúc đang xem) chỉ hiện một lần', () => {
    const v = reviewListView('all', src(page(['a', 'b'], 'c1')), none, { pages: [page(['b', 'c'])], isFetching: false, isError: false });
    expect(v.items.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('chip lọc: trang tải thêm nối vào kết quả của chip, không vào "Tất cả"', () => {
    const one = src(page(['x'], 'k1', 1));
    const v = reviewListView(1, src(page(['a'], 'c1')), one, { pages: [page(['y'], null, 1)], isFetching: false, isError: false });
    expect(v.items.map((x) => x.id)).toEqual(['x', 'y']);
    expect(v.hasMore).toBe(false);
  });

  it('đang tải trang kế: more "loading", dòng đã có vẫn hiện; lỗi: more "error", dòng đã có vẫn hiện', () => {
    const first = src(page(['a'], 'c1'));
    const loading = reviewListView('all', first, none, { pages: undefined, isFetching: true, isError: false });
    expect(loading).toMatchObject({ more: 'loading', hasMore: true });
    expect(loading.items.map((x) => x.id)).toEqual(['a']);
    const failed = reviewListView('all', first, none, { pages: [page(['b'], 'c2')], isFetching: false, isError: true });
    expect(failed).toMatchObject({ more: 'error', hasMore: true });
    expect(failed.items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('API cũ không trả nextCursor: không có trang sau', () => {
    expect(reviewListView('all', { data: { items: [r('a', 5)] }, isPending: false, isError: false }, none).hasMore).toBe(false);
  });

  it('reviewMoreStep: mỗi lần hiện thêm REVIEW_STEP dòng; dòng đã tải không còn dư mà còn trang thì tải trang kế', () => {
    expect(REVIEW_STEP).toBe(5);
    expect(reviewMoreStep(5, 100, true)).toEqual({ visible: 10, fetch: false });
    expect(reviewMoreStep(95, 100, true)).toEqual({ visible: 100, fetch: true });
    expect(reviewMoreStep(5, 6, true)).toEqual({ visible: 10, fetch: true });
    expect(reviewMoreStep(5, 6, false)).toEqual({ visible: 10, fetch: false });
    // Đang chờ trang kế (hiện vượt số đã tải) mà bấm lại: không cộng dồn quá số đã tải.
    expect(reviewMoreStep(15, 6, true)).toEqual({ visible: 11, fetch: true });
  });

  it('reviewHasMore: còn dòng đã tải chưa hiện hoặc máy chủ còn trang', () => {
    const items = [r('a', 5), r('b', 5)];
    expect(reviewHasMore(1, { items, hasMore: false })).toBe(true);
    expect(reviewHasMore(2, { items, hasMore: false })).toBe(false);
    expect(reviewHasMore(5, { items, hasMore: true })).toBe(true);
  });

  it('chữ nút dùng chung hai app', () => {
    expect(fillCopy('pdp.reviewsMore')).toBe('Xem thêm đánh giá');
  });
});
