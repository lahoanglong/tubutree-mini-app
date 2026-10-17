/**
 * Nguồn khách (kênh kéo khách về app): `shopee`, `lazada`, `tiktok`, `fb`, `oa`, `linkbio`, `ctv`, `card-<đợt>`, hoặc
 * mã khác theo cùng khuôn. Miniapp và web có bản parser riêng (utils/entry-source.ts, lib/entry-source.ts) dùng ĐÚNG
 * khuôn này; sửa khuôn ở một nơi phải sửa cả ba.
 */
export const ENTRY_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Chạm đầu do client khai quá 90 ngày thì bỏ hẳn: một bản lưu cũ không phải là lần chạm dẫn tới việc đăng ký lúc này. */
const FIRST_TOUCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Đồng hồ máy khách lệch về tương lai không quá mức này mới nhận. */
const FIRST_TOUCH_MAX_SKEW_MS = 10 * 60 * 1000;

/** Chuẩn hoá (cắt khoảng trắng, chữ thường) rồi đối chiếu khuôn; sai khuôn hay không phải chuỗi → null. */
export function normalizeEntryToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return ENTRY_TOKEN_PATTERN.test(v) ? v : null;
}

export interface FirstTouch {
  source: string;
  campaign: string | null;
  at: Date;
}

/**
 * Chạm đầu do client gửi kèm lúc đăng nhập. Đây là số liệu phân tích, không được làm hỏng đăng nhập: giá trị bẩn bị
 * bỏ im lặng chứ không trả 400. Nguồn bẩn hoặc chạm quá 90 ngày → bỏ cả lần chạm; chiến dịch bẩn → chỉ bỏ chiến dịch.
 */
export function sanitizeFirstTouch(raw: unknown, now: Date = new Date()): FirstTouch | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const source = normalizeEntryToken(o.source);
  if (!source) return null;
  const at = clientTouchTime(o.at, now);
  if (!at) return null;
  return { source, campaign: normalizeEntryToken(o.campaign), at };
}

/** Giờ chạm dùng được: giờ client nếu hợp lý, giờ máy chủ nếu thiếu/không đọc được/lệch đồng hồ; null nếu quá hạn 90 ngày. */
function clientTouchTime(raw: unknown, now: Date): Date | null {
  if (typeof raw !== 'string') return now;
  const at = new Date(raw);
  const age = now.getTime() - at.getTime();
  if (Number.isNaN(age) || age < -FIRST_TOUCH_MAX_SKEW_MS) return now;
  return age > FIRST_TOUCH_MAX_AGE_MS ? null : at;
}

/** Ba cột chạm đầu của User để ghép vào `data` của lệnh tạo; vắng hay bẩn → {}. */
export function firstTouchColumns(
  raw: unknown,
  now: Date = new Date(),
): { firstTouchSource?: string; firstTouchCampaign?: string | null; firstTouchAt?: Date } {
  const t = sanitizeFirstTouch(raw, now);
  return t ? { firstTouchSource: t.source, firstTouchCampaign: t.campaign, firstTouchAt: t.at } : {};
}
