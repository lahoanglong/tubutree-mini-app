/**
 * Bộ lọc và phân trang danh sách đánh giá ở PDP: số sao, có ảnh, có video. Máy chủ lọc trên mọi đánh giá đang hiện
 * (`reviewFilterQuery`), mỗi trang 100 dòng kèm `nextCursor`; lọc ở client chỉ thấy 100 dòng mới nhất nên sản phẩm nhiều đánh giá
 * từng báo "không có đánh giá khớp" dù có. Hai app chỉ vẽ.
 */
export type ReviewFilterKey = number | 'all' | 'photo' | 'video';

export interface ReviewFilterChip {
  key: ReviewFilterKey;
  label: string;
  count?: number;
}

/**
 * Chip "Có video" chỉ có khi sản phẩm thật sự có video; các chip còn lại luôn hiện để hàng chip không đổi theo dữ liệu.
 * Đang chọn "Có video" mà số video về 0 (đánh giá video cuối cùng bị ẩn) thì chip ở lại, ghi (0): chip biến mất khi đang chọn để lại danh sách trống
 * "không có đánh giá khớp" mà không chip nào đang sáng.
 * Đủ năm mức sao, kể cả 2 và 1 sao: biểu đồ phân bố đã vẽ cả năm mức, khách phải lọc riêng được đánh giá thấp để kiểm chứng (ẩn đi là mất tin cậy).
 */
export function reviewFilterChips(videoCount: number | undefined, selected?: ReviewFilterKey): ReviewFilterChip[] {
  const chips: ReviewFilterChip[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 5, label: '5 sao' },
    { key: 4, label: '4 sao' },
    { key: 3, label: '3 sao' },
    { key: 2, label: '2 sao' },
    { key: 1, label: '1 sao' },
    { key: 'photo', label: 'Có ảnh' },
  ];
  if ((videoCount ?? 0) > 0 || selected === 'video') chips.push({ key: 'video', label: 'Có video', count: videoCount ?? 0 });
  return chips;
}

type ReviewLike = { id: string; rating: number; images: readonly string[]; videoUrl: string | null };

/** Chạy lại trên kết quả máy chủ đã lọc (không đổi gì); giữ đúng chip khi API cũ bỏ qua tham số lọc và trả cả danh sách. */
export function filterReviews<T extends ReviewLike>(items: readonly T[], key: ReviewFilterKey): T[] {
  return items.filter((r) => {
    if (key === 'all') return true;
    if (key === 'photo') return r.images.length > 0;
    if (key === 'video') return Boolean(r.videoUrl);
    return r.rating === key;
  });
}

/**
 * Tham số gửi `GET /products/:slug/reviews` cho chip đang chọn; '' khi xem tất cả hoặc số sao máy chủ không nhận (ngoài 1..5).
 * `cursor` là `nextCursor` của trang trước cùng chip: máy chủ trả trang kế tiếp (đánh giá cũ hơn), không gửi là trang đầu.
 */
export function reviewFilterQuery(key: ReviewFilterKey, cursor?: string | null): string {
  const params: string[] = [];
  if (key === 'photo' || key === 'video') params.push(`media=${key}`);
  else if (typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= 5) params.push(`rating=${key}`);
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  return params.length > 0 ? `?${params.join('&')}` : '';
}

/**
 * Khoá cache trang đầu theo chip. "Tất cả" dùng chung khoá với dải Đánh giá nhanh và phần thống kê; chip khác thêm khoá lọc phía
 * sau nên làm mới `['reviews', slug]` sau khi viết, sửa đánh giá cũng làm mới mọi chip. Hàm tải của hai app gửi `cache: 'no-cache'`:
 * API đặt `max-age=30`, không có cờ đó trình duyệt trả lại bản cũ trong 30 giây và đánh giá vừa viết chưa hiện.
 */
export function reviewListKey(slug: string, key: ReviewFilterKey): readonly unknown[] {
  return key === 'all' ? ['reviews', slug] : ['reviews', slug, key];
}

/** Gốc khoá của mọi trang sau trang đầu; đổi chip thì bỏ hết để quay về trang đầu. */
export function reviewMorePrefix(slug: string): readonly unknown[] {
  return ['reviews', slug, 'more'];
}

/**
 * Khoá các trang sau trang đầu của một chip (một truy vấn nhiều trang). Gắn `after` là `nextCursor` của trang đầu: trang đầu tải lại
 * mà đổi dòng cuối (có đánh giá mới) thì các trang sau tải lại từ đúng chỗ nối, không sót dòng nằm giữa hai trang.
 * Vẫn dưới `['reviews', slug]` nên làm mới sau khi viết đánh giá cũng làm mới chúng.
 */
export function reviewMoreKey(slug: string, key: ReviewFilterKey, after: string): readonly unknown[] {
  return [...reviewMorePrefix(slug), key, after];
}

/** Một trang của `GET /products/:slug/reviews`: `nextCursor` null hoặc thiếu (API cũ) là hết. */
export interface ReviewPage<T> {
  items: readonly T[];
  nextCursor?: string | null;
}

export interface ReviewListSource<T> {
  data?: ReviewPage<T>;
  isPending: boolean;
  isError: boolean;
}

/** Các trang đã tải thêm sau trang đầu (truy vấn nhiều trang của app); thiếu khi khách chưa bấm "Xem thêm đánh giá". */
export interface ReviewMoreSource<T> {
  pages?: readonly ReviewPage<T>[];
  isFetching: boolean;
  isError: boolean;
}

export type ReviewListView<T> = {
  status: 'loading' | 'error' | 'ready';
  items: T[];
  /** Máy chủ còn trang sau trang cuối đã tải. */
  hasMore: boolean;
  /** Trạng thái tải trang kế: nút "Xem thêm đánh giá" quay khi 'loading', thành báo lỗi kèm thử lại khi 'error'. */
  more: 'idle' | 'loading' | 'error';
};

/**
 * Dòng hiện dưới hàng chip: trang đầu của chip rồi các trang đã tải thêm, theo thứ tự, bỏ dòng trùng id (đánh giá mới chen vào giữa
 * hai lần tải). Chip lọc lấy kết quả máy chủ của chính nó; khi chưa có thì báo đang tải chứ không lọc tạm danh sách "Tất cả"
 * (100 dòng mới nhất), vì như vậy là quay lại đúng lỗi báo "không có đánh giá khớp" sai.
 */
export function reviewListView<T extends ReviewLike>(
  key: ReviewFilterKey,
  all: ReviewListSource<T>,
  filtered: ReviewListSource<T>,
  more?: ReviewMoreSource<T>,
): ReviewListView<T> {
  const src = key === 'all' ? all : filtered;
  if (!src.data) return { status: src.isError ? 'error' : 'loading', items: [], hasMore: false, more: 'idle' };
  const pages = [src.data, ...(more?.pages ?? [])];
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages) {
    for (const r of page.items) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      items.push(r);
    }
  }
  return {
    status: 'ready',
    items: filterReviews(items, key),
    hasMore: Boolean(pages[pages.length - 1]!.nextCursor),
    more: more?.isFetching ? 'loading' : more?.isError ? 'error' : 'idle',
  };
}

/** Số dòng mỗi lần bấm "Xem thêm đánh giá" hiện thêm (một trang máy chủ là 100 dòng, hiện dần cho gọn). */
export const REVIEW_STEP = 5;

/**
 * Bấm "Xem thêm đánh giá": hiện thêm REVIEW_STEP dòng. Dòng đã tải không còn dư sau lần hiện này mà máy chủ còn trang thì tải trang
 * kế (`fetch`), nối vào cuối; các dòng đang hiện giữ nguyên.
 */
export function reviewMoreStep(visible: number, loaded: number, hasMore: boolean): { visible: number; fetch: boolean } {
  const next = Math.min(visible, loaded) + REVIEW_STEP;
  return { visible: next, fetch: hasMore && next >= loaded };
}

/** Còn dòng để hiện: đã tải mà chưa hiện, hoặc máy chủ còn trang. */
export function reviewHasMore(visible: number, view: Pick<ReviewListView<unknown>, 'items' | 'hasMore'>): boolean {
  return view.items.length > visible || view.hasMore;
}
