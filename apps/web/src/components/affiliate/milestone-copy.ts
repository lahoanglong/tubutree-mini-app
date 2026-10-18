import { formatVnd } from '@/lib/format-vnd';

export { progressPct } from '@tubutree/app-core/affiliate-rules';

/**
 * Chữ hiển thị cho bậc/mốc thưởng CTV, nói CÙNG một điều với backend (ctv-milestones.ts) và Mini App:
 * thưởng mốc là Điểm Xanh lô thường (không phải tiền rút được), bậc không kèm "+X% bonus hoa hồng",
 * doanh số tính mốc là doanh số ĐÃ CHỐT.
 */

export const formatPoints = (n: number): string => `${(Number.isFinite(n) ? n : 0).toLocaleString('vi-VN')} điểm`;

/** "2026-09" → "tháng 9/2026" (chuỗi lạ giữ nguyên). */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return `tháng ${Number(m[2])}/${m[1]}`;
}

export function milestoneStatusText(m: { achieved: boolean; claimed: boolean; threshold: number }, confirmedRevenue: number): string {
  if (m.claimed) return 'Đã cộng vào Điểm Xanh';
  if (m.achieved) return 'Đã đạt chỉ tiêu 🎉';
  return `Còn thiếu ${formatVnd(Math.max(0, m.threshold - confirmedRevenue))} doanh số đã chốt`;
}

/** Cột phải bảng 5 bậc: phần thưởng THẬT của bậc là thưởng mốc Điểm Xanh cùng ngưỡng. */
export function tierRewardLabel(t: { milestoneRewardPoints: number | null }): string {
  return t.milestoneRewardPoints ? `Thưởng mốc +${formatPoints(t.milestoneRewardPoints)}` : 'Bậc khởi đầu';
}

export function revenueRuleText(holdDays: number): string {
  return (
    `Doanh số đã chốt = giá trị hàng được hưởng hoa hồng (không gồm phí ship) của đơn đã giao ` +
    `và qua ${holdDays} ngày giữ đổi/trả, tính vào tháng được chốt (giờ Việt Nam).`
  );
}
