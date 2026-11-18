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
}
