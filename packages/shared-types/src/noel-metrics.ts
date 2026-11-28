/**
 * Số liệu Noel Xanh cho tab "Noel" của Admin (`GET /admin/analytics/noel?days=1|7|14`). Chỉ có kiểu, không có hằng số chạy:
 * gói này nằm trọn trong chunk khởi động của web. Chỉ số đếm, không có định danh khách.
 *
 * Ngày luôn theo giờ Việt Nam (UTC+7). `days` ngày cuối tính cả hôm nay (chưa đủ ngày).
 */
export type NoelWindowDays = 1 | 7 | 14;

export interface NoelDayCount {
  /** 'YYYY-MM-DD' giờ VN. */
  dayKey: string;
  count: number;
}

/** Số khách khác nhau và số lượt bấm của một thao tác. */
export interface NoelTapCount {
  users: number;
  taps: number;
}

export interface NoelOrnamentRow {
  /** `star | lights | baubles | gifts | reindeer | wreath` (khớp ORNAMENTS của app-core). */
  slot: string;
  /** Lần đầu khách chạm món đã đủ điều kiện (mở khoá và treo luôn). */
  unlock: NoelTapCount;
  /** Treo lại món đã mở khoá (không tính lần mở khoá đầu). */
  hang: NoelTapCount;
  remove: NoelTapCount;
}

export interface NoelGameRow {
  /** `dew_catcher | refill_rush` (arcade) hoặc mã game mini (`eco_merge`, `green_conveyor`, ...). */
  game: string;
  kind: 'arcade' | 'mini';
  /** Ván đã nộp kết quả trong cửa sổ. Arcade chỉ đếm từ lúc có sự kiện `arcade_run`. */
  plays: number;
  users: number;
  /** Arcade: điểm TB của ván. Mini: số câu đúng/bậc đạt TB. null khi chưa có ván. */
  avgScore: number | null;
  /** Mini: tổng TB của ván (mẫu số của `avgScore`). Arcade: null. */
  avgOutOf: number | null;
  rewardedPlays: number;
  water: number;
  points: number;
}

/** Thưởng game đã phát trong một khoảng ngày VN: để so với khoảng trước đó và với trần. */
export interface NoelEconomyPeriod {
  fromDayKey: string;
  toDayKey: string;
  /** Game mini (`game_daily_ledger`). */
  miniUsers: number;
  miniRewardedRounds: number;
  miniWater: number;
  miniPoints: number;
  maxUserWaterInDay: number;
  maxUserPointsInDay: number;
  /** Điểm Xanh game mini phát nhiều nhất trong một ngày của khoảng (`game_global_daily`). */
  maxGlobalPointsInDay: number;
  /** Arcade (`game_water_events`, lượt có thưởng). */
  arcadeRewardedRuns: number;
  arcadeWater: number;
}

export interface NoelRetentionGroup {
  /** Số cặp (khách, ngày) trong nhóm. */
  userDays: number;
  /** Số cặp có hoạt động vào ngày kế tiếp. */
  returned: number;
  /** null khi nhóm trống. */
  ratePct: number | null;
}

export interface NoelMetricsDTO {
  generatedAt: string;
  days: NoelWindowDays;
  /** `theme.seasonal` đang đặt; tab chỉ hiện khi là `christmas`. */
  seasonalTheme: string;
  fromDayKey: string;
  toDayKey: string;
  claims: {
    users: number;
    claims: number;
    perDay: NoelDayCount[];
    /** Khách đạt chuỗi điểm danh ≥ 3 / ≥ 7 ngày trong khoảng (điều kiện đủ để mở Quả châu đỏ / Tuần lộc, chưa chắc đã chạm mở). */
    reachedStreak3: number;
    reachedStreak7: number;
  };
  advent: {
    year: number;
    phase: 'before' | 'during' | 'after';
    /** Số ô đã tới ngày (0..12). */
    daysElapsed: number;
    opensByDay: Array<{ day: number; dayKey: string; users: number }>;
    openedAny: number;
    /**
     * Số ô phải mở đủ mới tính hoàn thành: tới HÔM QUA khi lịch đang chạy (ô hôm nay chưa hết ngày, tính vào thì tỉ lệ rơi về 0 mỗi sáng sớm),
     * đủ 12 sau 25/12. 0 ở trước 14/12 và đúng ngày 14/12.
     */
    requiredDays: number;
    /** Khách đã mở đủ `requiredDays` ô; null khi `requiredDays` là 0. */
    completed: number | null;
    completionPct: number | null;
  };
  ornaments: NoelOrnamentRow[];
  share: NoelTapCount;
  snow: {
    on: NoelTapCount;
    off: NoelTapCount;
    /** Lượt tắt / (lượt tắt + lượt bật); null khi chưa ai bấm. */
    offSharePct: number | null;
  };
  games: NoelGameRow[];
  economy: {
    caps: { miniWaterPerUserDay: number; miniPointsPerUserDay: number; miniGlobalPointsPerDay: number };
    current: NoelEconomyPeriod;
    previous: NoelEconomyPeriod;
  };
  retention: {
    /** Chỉ lấy ngày đã có đủ ngày kế tiếp (tức tới hôm kia). */
    cohortFromDayKey: string;
    cohortToDayKey: string;
    noel: NoelRetentionGroup;
    other: NoelRetentionGroup;
  };
}
