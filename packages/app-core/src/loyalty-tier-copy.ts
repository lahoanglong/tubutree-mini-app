// Tách khỏi loyalty-copy.ts: Mini App có gói đầu nạp module đó, export nào còn được dùng ở trang con sẽ kéo cả khối vào gói đầu.

/** Tiêu đề khối mã giảm giá khi lỗi tải; thân chỉ ghi lý do. */
export const COUPONS_LOAD_ERROR_TITLE = 'Chưa tải được mã giảm giá';

/**
 * Thứ hạng (0 = thấp nhất) của một hạng trong danh sách đã sắp theo `sortOrder`. Biểu tượng và màu hạng tra theo thứ hạng này,
 * không theo tên, để đổi tên hạng trong admin không làm mất biểu tượng.
 */
export function tierRank(tiers: readonly { id: string; name?: string }[], ref: { id?: string | null; name?: string | null }): number {
  const i = tiers.findIndex((t) => (ref.id != null ? t.id === ref.id : ref.name != null && t.name === ref.name));
  return i < 0 ? 0 : i;
}

export { tierGraceLine } from './tier-grace-line';
