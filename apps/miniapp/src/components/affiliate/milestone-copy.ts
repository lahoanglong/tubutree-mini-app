import { formatVnd } from '../../utils/format';

/**
 * Chữ hiển thị cho bậc/mốc thưởng CTV (affiliate.tsx). Tách thuần để test được và để mọi chỗ
 * nói CÙNG một điều với backend (apps/api/src/modules/affiliate/ctv-milestones.ts):
 * - Thưởng mốc là Tubu Xu (coinsBalance) — KHÔNG phải "điểm" (Điểm Xanh) hay tiền rút được.
 * - Bậc CTV không kèm "+X% bonus hoa hồng" — backend không trả khoản đó.
 * - Doanh số tính mốc là doanh số ĐÃ CHỐT (đơn đã giao + hết thời gian giữ đổi/trả).
 */

/** 50000 → "50.000 xu". */
export function formatXu(n: number): string {
  return `${n.toLocaleString('vi-VN')} xu`;
}

/** "2026-09" → "tháng 9/2026" (chuỗi lạ giữ nguyên). */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return `tháng ${Number(m[2])}/${m[1]}`;
}

export function milestoneStatusText(
  m: { achieved: boolean; claimed: boolean; threshold: number },
  confirmedRevenue: number,
): string {
  if (m.claimed) return 'Đã cộng vào ví Tubu Xu';
  if (m.achieved) return 'Đã đạt chỉ tiêu 🎉';
  return `Còn thiếu ${formatVnd(Math.max(0, m.threshold - confirmedRevenue))} doanh số đã chốt`;
}

/** Cột phải bảng 5 bậc: phần thưởng THẬT của bậc là thưởng mốc xu cùng ngưỡng. */
export function tierRewardLabel(t: { milestoneRewardXu: number | null }): string {
  return t.milestoneRewardXu ? `Thưởng mốc +${formatXu(t.milestoneRewardXu)}` : 'Bậc khởi đầu';
}

/**
 * % thanh tiến độ lên bậc — mirror milestoneProgressPct của backend: chưa tới ngưỡng thì tối đa
 * 99 (Math.round cũ làm 9,99tr/10tr hiện 100% trong khi vẫn "Còn … để lên bậc").
 */
export function progressPct(revenue: number, threshold: number): number {
  if (threshold <= 0 || revenue >= threshold) return 100;
  return Math.max(0, Math.min(99, Math.floor((revenue / threshold) * 100)));
}

export function revenueRuleText(holdDays: number): string {
  return (
    `Doanh số đã chốt = giá trị hàng được hưởng hoa hồng (không gồm phí ship) của đơn đã giao ` +
    `và qua ${holdDays} ngày giữ đổi/trả, tính vào tháng được chốt (giờ Việt Nam).`
  );
}
