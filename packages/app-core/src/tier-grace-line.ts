import type { LoyaltyOverview } from './api/loyalty';

// Tách riêng để thẻ thành viên (gói đầu của Mini App) dùng được mà không kéo `loyalty-tier-copy` (chỉ trang con dùng) vào gói đầu.

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
