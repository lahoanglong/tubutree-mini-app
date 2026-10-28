/** Helpers thuần cho refresh token Zalo OA (test dễ, không chạm DB/HTTP). */

/**
 * Token sống ~25 giờ, cron chạy mỗi 6 giờ: ngưỡng 13 giờ để ít nhất hai lượt cron (còn ≤13h và còn ≤7h) cùng thử trước
 * khi hết hạn; một lượt lỗi không làm ZNS ngừng.
 */
export const REFRESH_THRESHOLD_HOURS = 13;

/** Có cần làm mới token không: chưa biết hạn / hạn không hợp lệ / còn ≤ ngưỡng giờ → refresh. */
export function needsRefresh(expiresAtIso: string | null, now: Date, thresholdHours = REFRESH_THRESHOLD_HOURS): boolean {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  if (Number.isNaN(t)) return true;
  return t - now.getTime() <= thresholdHours * 3600 * 1000;
}

/** Mốc hết hạn ISO từ expires_in (giây) Zalo trả về. */
export function computeExpiresAt(expiresInSec: number, now: Date): string {
  const sec = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 86400;
  return new Date(now.getTime() + sec * 1000).toISOString();
}
