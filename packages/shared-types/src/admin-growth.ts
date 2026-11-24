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

/**
 * Tin nhắc chủ động được gán đơn ("Tin nào ra đơn"), theo thứ tự hiện trên bảng. Mỗi khoá ứng với một mẫu tin của API
 * (apps/api lifecycle/remarketing-attribution.ts): giỏ bỏ quên, mã quay lại, giá món Yêu thích giảm, nhắc Refill 21 ngày, nhắc chuyển khoản.
 */
export const REMARKETING_NOTICES = ['abandoned_cart', 'winback', 'wishlist_price_drop', 'refill_21d', 'payment_reminder'] as const;
export type RemarketingNotice = (typeof REMARKETING_NOTICES)[number];

/** Đơn đặt trong ngần ấy giờ sau tin thì được gán cho tin (nhắc chuyển khoản: đơn được trả tiền hoặc đổi sang trả tiền khi nhận trong ngần ấy giờ sau tin). */
export const REMARKETING_ATTRIBUTION_HOURS = 72;

export interface RemarketingAttributionRow {
  notice: RemarketingNotice;
  /** Tin đã gửi trong kỳ: mỗi lần gửi là một tin trong app (ZNS là bản ngoài app của cùng tin, không đếm thêm). */
  sent: number;
  /** Trong số đó, tin Zalo đã nhận qua ZNS (tính phí). */
  znsSent: number;
  /** Bản ZNS bị trần tin chủ động bỏ (ngày/tuần, hoặc nhường lượt); khách vẫn có tin trong app. Nhắc chuyển khoản là tin giao dịch nên không bị trần. */
  znsCapped: number;
  /** Bản ZNS bị trần tin khuyến mãi ZNS theo tháng bỏ (`notifications.zns_promo_monthly_cap`). Chỉ có từ bản API ghi lý do này. */
  znsMonthlyCapped: number;
  /** Đơn thành công gán cho tin gửi trong kỳ (gộp đơn tách theo nhà bán); mỗi đơn chỉ gán cho một tin. */
  orders: number;
  /** Doanh thu đã thu của các đơn đó, cùng luật báo cáo Doanh thu (COD chưa giao chưa tính). */
  revenue: number;
}

export interface RemarketingAttributionDTO {
  windowHours: number;
  /** Đủ mọi khoá của REMARKETING_NOTICES theo đúng thứ tự, kể cả dòng 0. */
  rows: RemarketingAttributionRow[];
  /** Trần tin chủ động ngoài app (`notify.proactive_cap_enabled`); null khi trần đang tắt. */
  proactiveCap: { perDay: number; perWeek: number } | null;
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
  /** Bảng "Tin nào ra đơn". Không có khi API cũ chưa trả; null khi lần tính này không đọc được số liệu (phần còn lại vẫn hiện). */
  remarketing?: RemarketingAttributionDTO | null;
}
