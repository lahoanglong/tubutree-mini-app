import type { PurchaseFunnelWindowDTO } from './analytics';

/**
 * Trung tâm tăng trưởng của admin (`GET /admin/growth/overview?days=7|30`): phễu mua theo phiên, tỷ lệ mua lần 2 và tỷ lệ người chơi game
 * đặt đơn. Chỉ có số đếm, không có định danh khách.
 */
export const GROWTH_WINDOW_DAYS = [7, 30] as const;
export type GrowthWindowDays = (typeof GROWTH_WINDOW_DAYS)[number];

export function toGrowthWindowDays(raw: unknown): GrowthWindowDays {
  return raw === 30 || raw === '30' ? 30 : 7;
}

/** Một ngày VN (`YYYY-MM-DD`) của biểu đồ theo ngày. */
export interface GrowthDailyPoint {
  day: string;
  /** Đơn thành công (gộp đơn tách theo nhà bán của cùng một lần đặt). */
  orders: number;
  /** Tài khoản chơi ít nhất một ván game mini hoặc một lượt Chọn Chuẩn Xanh trong ngày. */
  players: number;
}

export interface GrowthGameRow {
  /** `game` của `game_play_rounds`: sort, daily_quiz, match, origin, basket, matcher, hoặc game mới thêm sau. */
  game: string;
  players: number;
  /** Người chơi có đơn thành công sau lượt chơi đầu tiên của họ trong kỳ. */
  buyers: number;
}

/** Lý do luật chống tự giới thiệu chặn thưởng đơn đầu (apps/api referral/first-order-guard.ts), theo thứ tự xét. */
export const REFERRAL_GUARD_REASONS = ['SELF', 'PHONE', 'ZALO', 'ADDRESS', 'IP'] as const;
export type ReferralGuardReason = (typeof REFERRAL_GUARD_REASONS)[number];

/** Thưởng mời bạn đơn đầu trong kỳ: để theo dõi luật IP chặn nhầm bạn thật (4G, Wi-Fi văn phòng dùng chung IP). */
export interface ReferralFirstOrderGuardDTO {
  /** Cặp đã nhận thưởng đơn đầu (mỗi cặp một dòng sổ điểm của người mời). */
  rewarded: number;
  /** Đơn đầu bị chặn, mỗi đơn một lần theo lý do của lần chặn đầu tiên. */
  blocked: Record<ReferralGuardReason, number>;
}

/** Lượt khách bấm gửi link mời trong kỳ (sự kiện `green_card_shared`), theo cách gửi. */
export interface ReferralShareStatsDTO {
  /** Mở hộp chia sẻ (Zalo Mini App, Web Share API, hay chép lời mời khi máy không có hộp chia sẻ). */
  share: number;
  /** Sao chép link mời. */
  copy: number;
}

export interface AdminGrowthOverviewDTO {
  generatedAt: string;
  days: GrowthWindowDays;
  /** Ngày VN đầu tiên của kỳ; kỳ gồm cả hôm nay. */
  sinceDay: string;
  /** Phễu mua theo phiên của `days` ngày gần nhất (cùng số với bảng Theo dõi 72h). */
  funnel: PurchaseFunnelWindowDTO;
  repeat: {
    /** Khách có đơn đầu tiên trong kỳ. */
    newBuyers: number;
    /** Trong số đó, khách đã có đơn thứ hai (tính tới lúc xem). */
    newBuyersWithSecond: number;
    /** Khách có đơn trong kỳ. */
    buyers: number;
    /** Trong số đó, khách có đơn trong kỳ là đơn thứ hai trở đi. */
    returningBuyers: number;
  };
  games: { players: number; buyers: number; byGame: GrowthGameRow[] };
  daily: GrowthDailyPoint[];
  referralFirstOrder: ReferralFirstOrderGuardDTO;
  /** Optional: API cũ chưa trả, khi đó khối không có dòng lượt gửi. */
  referralShares?: ReferralShareStatsDTO;
}
