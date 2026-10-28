import type { LoyaltyOverview } from './api/loyalty';

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

/** Dòng báo hạn giữ hạng ("Giữ hạng Lộc Biếc: đơn giao thành công thêm 400.000đ trước 07/11/2026"); null khi hạng đang ổn. */
export function tierGraceLine(
  grace: LoyaltyOverview['tierGrace'],
  tierName: string,
  fmt: { money: (n: number) => string; points: (n: number) => string; date: (iso: string) => string },
): string | null {
  if (!grace) return null;
  const left = grace.spendingToKeep != null ? grace.spendingToKeep : grace.pointsToKeep;
  if (left <= 0) return `Bạn đang đủ điều kiện giữ hạng ${tierName}`;
  const need = grace.spendingToKeep != null ? `đơn giao thành công thêm ${fmt.money(left)}` : `tích thêm ${fmt.points(left)} điểm từ đơn giao thành công`;
  return `Giữ hạng ${tierName}: ${need} trước ${fmt.date(grace.until)}`;
}
