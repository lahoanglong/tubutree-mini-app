/** Bộ lọc danh sách đánh giá ở PDP: số sao, có ảnh, có video. Hai app chỉ vẽ chip, không tự lọc. */
export type ReviewFilterKey = number | 'all' | 'photo' | 'video';

export interface ReviewFilterChip {
  key: ReviewFilterKey;
  label: string;
  count?: number;
}

/** Chip "Có video" chỉ có khi sản phẩm thật sự có video; các chip còn lại luôn hiện để hàng chip không đổi theo dữ liệu. */
export function reviewFilterChips(videoCount: number | undefined): ReviewFilterChip[] {
  const chips: ReviewFilterChip[] = [
    { key: 'all', label: 'Tất cả' },
    { key: 5, label: '5 sao' },
    { key: 4, label: '4 sao' },
    { key: 3, label: '3 sao' },
    { key: 'photo', label: 'Có ảnh' },
  ];
  if ((videoCount ?? 0) > 0) chips.push({ key: 'video', label: 'Có video', count: videoCount });
  return chips;
}

export function filterReviews<T extends { rating: number; images: readonly string[]; videoUrl: string | null }>(items: readonly T[], key: ReviewFilterKey): T[] {
  return items.filter((r) => {
    if (key === 'all') return true;
    if (key === 'photo') return r.images.length > 0;
    if (key === 'video') return Boolean(r.videoUrl);
    return r.rating === key;
  });
}
