/**
 * Bậc CTV + mốc thưởng doanh số tháng (Build Spec §6.8.2) — dữ liệu & hàm thuần, dùng chung cho
 * AffiliateService (dashboard/getMe/getCtvTiers/getMilestones/claimMilestone) để mọi nơi cùng
 * MỘT định nghĩa doanh số + ranh giới tháng (trước đây bảng bậc bị chép 2 lần trong service).
 *
 * "Doanh số tháng" = tổng Commission.commissionableTotal của commission ĐÃ CHỐT (APPROVED/PAID)
 * có approvedAt trong tháng (giờ VN). Commission chỉ lên APPROVED sau khi đơn DELIVERED + hết
 * max(affiliate.hold_days, returns.window_days) + không còn yêu cầu đổi/trả chờ duyệt
 * (AffiliateService.approveDueCommissions) và reverseCommissionsForOrder CHỈ đảo PENDING/LOCKED
 * → doanh số đã chốt không bao giờ bị đơn huỷ/trả kéo xuống, nên thưởng mốc đã nhận không cần
 * clawback. Không tính PENDING (đơn còn huỷ được) — lỗ hổng cũ: lên đơn hộ 80tr COD, nhận 2,85tr
 * thưởng rồi tự huỷ đơn.
 *
 * Bậc chỉ là DANH HIỆU theo doanh số — KHÔNG có "+X% bonus hoa hồng": chưa có luồng nào trả
 * khoản đó (không cộng lúc tạo commission, không có cron quyết toán) nên không được hứa trên UI.
 * Phần thưởng thật duy nhất của bậc là thưởng mốc TubuXu cùng ngưỡng bên dưới.
 */

/** Chênh lệch giờ VN (UTC+7) — mirror DealerService.VN_OFFSET / staff time.util. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface VnMonth {
  /** 'YYYY-MM' theo giờ VN. */
  key: string;
  /** Mốc UTC [start, end) của tháng theo giờ tường VN. */
  start: Date;
  end: Date;
}

/** Tháng VN chứa `now` (dịch `offsetMonths`, vd -1 = tháng trước), độc lập TZ máy chủ. */
export function vnMonthBounds(now: Date, offsetMonths = 0): VnMonth {
  const vn = new Date(now.getTime() + VN_OFFSET_MS); // giờ tường VN, đọc qua các field UTC*
  const first = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + offsetMonths, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - VN_OFFSET_MS),
  };
}

/** 00:00 giờ VN của ngày chứa `now` (thời điểm UTC tương ứng). */
export function vnDayStart(now: Date): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS);
}

/** Commission đã chốt — không còn đường đảo (reverseCommissionsForOrder chỉ đụng PENDING/LOCKED). */
export const CONFIRMED_COMMISSION_STATUSES = ['APPROVED', 'PAID'] as const;
/** Commission còn chờ chốt (đơn chưa giao / đang trong hold đổi-trả) — chỉ để HIỂN THỊ. */
export const PENDING_COMMISSION_STATUSES = ['PENDING', 'LOCKED'] as const;

export interface CtvTier {
  name: string;
  emoji: string;
  min: number;
}

export const CTV_TIERS: readonly CtvTier[] = [
  { name: 'Tân binh', emoji: '🌱', min: 0 },
  { name: 'Đồng', emoji: '🌿', min: 3_000_000 },
  { name: 'Bạc', emoji: '🌳', min: 10_000_000 },
  { name: 'Vàng', emoji: '🌲', min: 30_000_000 },
  { name: 'Kim Cương', emoji: '💎', min: 80_000_000 },
];

export interface CtvMilestone {
  id: string;
  title: string;
  threshold: number;
  rewardXu: number;
  description: string;
}

export const CTV_MONTHLY_MILESTONES: CtvMilestone[] = [
  {
    id: 'milestone-3m',
    title: 'Mốc Khởi Động 3 Triệu',
    threshold: 3_000_000,
    rewardXu: 50_000,
    description: 'Đạt 3.000.000đ doanh số đã chốt trong tháng',
  },
  {
    id: 'milestone-10m',
    title: 'Mốc Tăng Tốc 10 Triệu',
    threshold: 10_000_000,
    rewardXu: 200_000,
    description: 'Đạt 10.000.000đ doanh số đã chốt trong tháng',
  },
  {
    id: 'milestone-30m',
    title: 'Mốc Bứt Phá 30 Triệu',
    threshold: 30_000_000,
    rewardXu: 600_000,
    description: 'Đạt 30.000.000đ doanh số đã chốt trong tháng',
  },
  {
    id: 'milestone-80m',
    title: 'Mốc Đỉnh Cao 80 Triệu',
    threshold: 80_000_000,
    rewardXu: 2_000_000,
    description: 'Đạt 80.000.000đ doanh số đã chốt trong tháng',
  },
];

/** Bậc hiện tại + bậc kế theo doanh số. */
export function tierForRevenue(revenue: number) {
  let idx = 0;
  for (let i = 0; i < CTV_TIERS.length; i++) if (revenue >= CTV_TIERS[i]!.min) idx = i;
  const cur = CTV_TIERS[idx]!;
  const next = CTV_TIERS[idx + 1];
  return {
    name: cur.name,
    emoji: cur.emoji,
    nextName: next?.name ?? null,
    nextThreshold: next?.min ?? null,
    toNext: next ? Math.max(0, next.min - revenue) : 0,
  };
}

/** Bảng 5 bậc kèm thưởng mốc xu cùng ngưỡng (null nếu bậc không có mốc, vd Tân binh). */
export function tiersWithRewards() {
  return CTV_TIERS.map((t) => ({
    ...t,
    milestoneRewardXu: CTV_MONTHLY_MILESTONES.find((m) => m.threshold === t.min)?.rewardXu ?? null,
  }));
}

/**
 * % tiến độ mốc. Chưa đạt thì tối đa 99 (Math.round cũ làm 2,99tr/3tr hiện 100% trong khi nút
 * vẫn "Chưa đạt"); đạt/vượt → 100.
 */
export function milestoneProgressPct(revenue: number, threshold: number): number {
  if (threshold <= 0 || revenue >= threshold) return 100;
  return Math.max(0, Math.min(99, Math.floor((revenue / threshold) * 100)));
}
