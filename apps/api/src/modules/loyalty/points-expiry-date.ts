/** Số tháng hạn dùng khi loyalty.point_expire_months hỏng (không phải số hữu hạn dương). */
export const DEFAULT_POINT_EXPIRE_MONTHS = 12;

/** Số tháng hạn dùng hợp lệ: số hữu hạn dương (làm tròn xuống), còn lại về mặc định 12. */
export function normalizePointExpireMonths(rawMonths: unknown): number {
  return typeof rawMonths === 'number' && Number.isFinite(rawMonths) && rawMonths > 0 ? Math.floor(rawMonths) : DEFAULT_POINT_EXPIRE_MONTHS;
}

/**
 * Hạn của điểm Xanh thường (lô STANDARD) cộng vào lúc `from`: `from` + loyalty.point_expire_months tháng nguyên.
 * Cấu hình 0, âm, NaN, vô hạn hay không phải số rơi về 12 tháng: để nguyên thì điểm vừa cộng đã hết hạn hoặc nằm trong
 * quá khứ và cron trừ lại ngay đêm sau, hay `Date` không hợp lệ làm hỏng lệnh ghi.
 *
 * Một nơi tính duy nhất cho mọi nguồn cộng điểm thường (điểm đơn giao, thưởng, điểm danh, POS, điểm hoàn, game, đánh
 * giá); LoyaltyService.pointsExpiresAt đọc cấu hình rồi gọi hàm này, RewardPointsService (module wallet) cũng vậy.
 */
export function pointsExpiryFrom(from: Date, rawMonths: unknown): Date {
  const months = normalizePointExpireMonths(rawMonths);
  const expiresAt = new Date(from.getTime());
  expiresAt.setMonth(expiresAt.getMonth() + months);
  return expiresAt;
}
