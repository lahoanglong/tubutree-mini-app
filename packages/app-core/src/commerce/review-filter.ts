/**
 * Bộ lọc danh sách đánh giá ở PDP: số sao, có ảnh, có video. Máy chủ lọc trên mọi đánh giá đang hiện (`reviewFilterQuery`);
 * lọc ở client chỉ thấy 100 dòng mới nhất nên sản phẩm nhiều đánh giá từng báo "không có đánh giá khớp" dù có. Hai app chỉ vẽ.
 */
export type ReviewFilterKey = number | 'all' | 'photo' | 'video';

export interface ReviewFilterChip {
  key: ReviewFilterKey;
  label: string;
  count?: number;
}

/**
 * Chip "Có video" chỉ có khi sản phẩm thật sự có video; các chip còn lại luôn hiện để hàng chip không đổi theo dữ liệu.
 * Đủ năm mức sao, kể cả 2 và 1 sao: biểu đồ phân bố đã vẽ cả năm mức, khách phải lọc riêng được đánh giá thấp để kiểm chứng (ẩn đi là mất tin cậy).
 */
export function reviewFilterChips(videoCount: number | undefined): ReviewFilterChip[] {
  const chips: ReviewFilterChip[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 5, label: '5 sao' },
    { key: 4, label: '4 sao' },
    { key: 3, label: '3 sao' },
    { key: 2, label: '2 sao' },
    { key: 1, label: '1 sao' },
    { key: 'photo', label: 'Có ảnh' },
  ];
  if ((videoCount ?? 0) > 0) chips.push({ key: 'video', label: 'Có video', count: videoCount });
  return chips;
}

type ReviewLike = { rating: number; images: readonly string[]; videoUrl: string | null };

/** Chạy lại trên kết quả máy chủ đã lọc (không đổi gì); giữ đúng chip khi API cũ bỏ qua tham số lọc và trả cả danh sách. */
export function filterReviews<T extends ReviewLike>(items: readonly T[], key: ReviewFilterKey): T[] {
  return items.filter((r) => {
    if (key === 'all') return true;
    if (key === 'photo') return r.images.length > 0;
    if (key === 'video') return Boolean(r.videoUrl);
    return r.rating === key;
  });
}

/** Tham số gửi `GET /products/:slug/reviews` cho chip đang chọn; '' khi xem tất cả hoặc số sao máy chủ không nhận (ngoài 1..5). */
export function reviewFilterQuery(key: ReviewFilterKey): string {
  if (key === 'photo' || key === 'video') return `?media=${key}`;
  if (typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= 5) return `?rating=${key}`;
  return '';
}

/**
 * Khoá cache danh sách theo chip. "Tất cả" dùng chung khoá với dải Đánh giá nhanh và phần thống kê; chip khác thêm khoá lọc phía
 * sau nên làm mới `['reviews', slug]` sau khi viết, sửa đánh giá cũng làm mới mọi chip. Hàm tải của hai app gửi `cache: 'no-cache'`:
 * API đặt `max-age=30`, không có cờ đó trình duyệt trả lại bản cũ trong 30 giây và đánh giá vừa viết chưa hiện.
 */
export function reviewListKey(slug: string, key: ReviewFilterKey): readonly unknown[] {
  return key === 'all' ? ['reviews', slug] : ['reviews', slug, key];
}

export interface ReviewListSource<T> {
  data?: { items: readonly T[] };
  isPending: boolean;
  isError: boolean;
}

export type ReviewListView<T> = { status: 'loading' | 'error' | 'ready'; items: T[] };

/**
 * Dòng hiện dưới hàng chip. Chip lọc lấy kết quả máy chủ của chính nó; khi chưa có thì báo đang tải chứ không lọc tạm danh sách
 * "Tất cả" (100 dòng mới nhất), vì như vậy là quay lại đúng lỗi báo "không có đánh giá khớp" sai.
 */
export function reviewListView<T extends ReviewLike>(key: ReviewFilterKey, all: ReviewListSource<T>, filtered: ReviewListSource<T>): ReviewListView<T> {
  const src = key === 'all' ? all : filtered;
  if (src.data) return { status: 'ready', items: filterReviews(src.data.items, key) };
  return { status: src.isError ? 'error' : 'loading', items: [] };
}

/** Số dòng tối đa API trả cho một danh sách (`LIST_LIMIT` ở reviews.service). */
export const REVIEW_LIST_LIMIT = 100;

export interface ReviewStats {
  count: number;
  videoCount?: number;
  distribution?: Record<string, number>;
}

/**
 * Danh sách của chip chỉ là 100 đánh giá mới nhất, đánh giá cũ hơn không tải: báo để khách không tưởng sản phẩm chỉ có chừng ấy.
 * Chip có tổng (Tất cả, số sao, Có video) thì so tổng; chip "Có ảnh" không có tổng nên đủ 100 dòng là coi như bị cắt.
 */
export function reviewListCapped(key: ReviewFilterKey, stats: ReviewStats | undefined, shown: number): boolean {
  if (shown < REVIEW_LIST_LIMIT) return false;
  const total =
    key === 'all' ? stats?.count : key === 'video' ? stats?.videoCount : typeof key === 'number' ? stats?.distribution?.[String(key)] : undefined;
  return total === undefined || total > shown;
}
