import type { SystemConfigService } from '../system-config/system-config.service';

/** Cờ Góc Sống Xanh: tắt thì đánh giá, thưởng và Trang chủ như cũ (migration 20261118142510_review_green_corner, seed createOnly). */
export const GREEN_CORNER_ENABLED_KEY = 'reviews.green_corner_enabled';
export const PHOTO_REWARD_POINTS_KEY = 'reviews.photo_reward_points';
export const PHOTO_REWARD_DAILY_CAP_KEY = 'reviews.photo_reward_daily_cap';

/** +100 Điểm Xanh mỗi đánh giá ảnh thật được duyệt (quyết định A6 của chủ, 18/11). 1 điểm = 1đ. */
export const PHOTO_REWARD_POINTS_DEFAULT = 100;
export const PHOTO_REWARD_DAILY_CAP_DEFAULT = 3;
/** Trần nhập ở Admin (cùng biên ở SystemConfigService.RANGES): số lỗi hay quá trần thì dùng mặc định, không thưởng số lạ. */
export const PHOTO_REWARD_POINTS_MAX = 20_000;
export const PHOTO_REWARD_DAILY_CAP_MAX = 50;

export interface GreenCornerConfig {
  enabled: boolean;
  /** Điểm cộng lúc duyệt; 0 = duyệt không cộng. */
  rewardPoints: number;
  /** Số đánh giá được thưởng tối đa cho các đánh giá một khách viết cùng ngày (giờ VN); 0 = không thưởng. */
  dailyCap: number;
}

const intIn = (v: unknown, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback;

/** Chỉ boolean true thật mới bật: chuỗi "false" là truthy ở chỗ đọc lỏng. */
export async function readGreenCornerConfig(config: Pick<SystemConfigService, 'get'>): Promise<GreenCornerConfig> {
  const [enabled, points, cap] = await Promise.all([
    config.get<unknown>(GREEN_CORNER_ENABLED_KEY, false),
    config.get<unknown>(PHOTO_REWARD_POINTS_KEY, PHOTO_REWARD_POINTS_DEFAULT),
    config.get<unknown>(PHOTO_REWARD_DAILY_CAP_KEY, PHOTO_REWARD_DAILY_CAP_DEFAULT),
  ]);
  return {
    enabled: enabled === true,
    rewardPoints: intIn(points, PHOTO_REWARD_POINTS_MAX, PHOTO_REWARD_POINTS_DEFAULT),
    dailyCap: intIn(cap, PHOTO_REWARD_DAILY_CAP_MAX, PHOTO_REWARD_DAILY_CAP_DEFAULT),
  };
}

/** Dòng sổ thưởng Góc Sống Xanh, một lần cho mỗi dòng đơn (partial unique points_transactions_review_photo_key). */
export const photoRewardReason = (orderItemId: string): string => `REVIEW_PHOTO:${orderItemId}`;

/**
 * Dấu ảnh/video admin đang xem ở màn duyệt (tab Đánh giá gửi lại nguyên văn khi bấm Duyệt hay Hiện lại). `imageVersions` do trigger DB
 * giữ theo `images` nên khách đổi ảnh giữa lúc admin mở danh sách và lúc bấm thì dấu lệch: máy chủ trả 409, ảnh chưa ai xem không lên công khai.
 */
export const reviewMediaKey = (imageVersions: readonly string[], videoUrl: string | null): string => JSON.stringify([imageVersions, videoUrl]);

/** Khoá advisory theo khách cho trần thưởng theo ngày: hai lần duyệt cùng lúc của một khách không cùng đọc "còn 1 suất". */
export const photoRewardCapLockKey = (userId: string): string => `review-photo-cap:${userId}`;

/**
 * Vì sao lần duyệt không cộng điểm (để admin thấy và trả lời khách đúng):
 * NOT_ENROLLED = đánh giá không đi qua hàng chờ (đánh giá cũ admin chỉ chọn đưa lên dải); NO_MEDIA = không có ảnh/video thật;
 * ALREADY_REWARDED = đánh giá đã nhận thưởng lúc gửi (bảng cũ) hoặc dòng đơn đã nhận thưởng Góc Sống Xanh; RETURNED = dòng hàng đã trả;
 * DAILY_CAP = khách đã đủ số đánh giá được thưởng của ngày viết; ZERO = cấu hình thưởng 0 điểm.
 */
export type PhotoRewardSkip = 'NOT_ENROLLED' | 'NO_MEDIA' | 'ALREADY_REWARDED' | 'RETURNED' | 'DAILY_CAP' | 'ZERO';

export interface ApproveResult {
  ok: true;
  isVisible: true;
  /** Đánh giá đã được duyệt trước đó: lần bấm này không đổi gì. */
  alreadyApproved: boolean;
  rewardPoints: number;
  rewardSkipped: PhotoRewardSkip | null;
}

/** Chữ máy chủ trả kèm: một nhận xét dài không được làm thẻ dải Trang chủ cao lên. */
export const GREEN_CORNER_COMMENT_MAX = 120;

export function clipComment(comment: string | null): string | null {
  const t = comment?.replace(/\s+/g, ' ').trim() ?? '';
  if (!t) return null;
  if (t.length <= GREEN_CORNER_COMMENT_MAX) return t;
  return `${t.slice(0, GREEN_CORNER_COMMENT_MAX - 1).trimEnd()}…`;
}
