/** Helpers thuần cho refresh token Zalo OA (test dễ, không chạm DB/HTTP). */

/** Có cần làm mới token không: chưa biết hạn / hạn không hợp lệ / còn ≤ ngưỡng giờ → refresh. */
export function needsRefresh(expiresAtIso: string | null, now: Date, thresholdHours = 6): boolean {
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
