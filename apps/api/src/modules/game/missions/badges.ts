import { Prisma } from '@prisma/client';
import type { BadgeId } from '@tubutree/shared-types';
import { LEGACY_REFERRAL_CASHBACK_PREFIX, REFERRAL_ORDER2_PREFIX, REFERRAL_ORDER2_REVOKE_PREFIX } from '../../wallet/referral-reward';

/**
 * Điều kiện của 8 huy hiệu, mỗi cái là MỘT câu SELECT trả các "userId" đã đạt. Cùng một câu cho job đêm (mọi khách) và cho lúc khách mở
 * hàng huy hiệu (lọc một khách), nên hai đường không lệch định nghĩa. Chỉ đọc: bảng `waste_*` chỉ được SELECT.
 *
 * Đơn tính như nhiệm vụ một lần và đánh giá (REVIEWABLE_ORDER): bán lẻ, đã giao, không phải đơn CTV lên hộ khách. Hàng refill nhận theo
 * slug lúc mua (`refill-…`) hoặc tên bắt đầu bằng "Refill", đúng cách đặt tên của danh mục Fuwa3e. Đố Xanh "đúng cả 3" đếm theo NGÀY
 * (cùng bộ câu cả ngày, chơi lại không tính thêm). Mời bạn dùng đúng sổ của chương trình giới thiệu (thưởng trừ lần thu hồi, cả sổ xu cũ).
 */
type Rule = (user: Prisma.Sql) => Prisma.Sql;

const RETAIL_DELIVERED = Prisma.sql`o.status = 'DELIVERED' AND o.type = 'RETAIL' AND o."placedForCustomer" = false`;

const REFERRAL_ROWS = Prisma.sql`
  SELECT "userId", reason FROM points_transactions
   WHERE "refType" = 'REFERRAL' AND (starts_with(reason, ${REFERRAL_ORDER2_PREFIX}) OR starts_with(reason, ${REFERRAL_ORDER2_REVOKE_PREFIX}) OR starts_with(reason, ${LEGACY_REFERRAL_CASHBACK_PREFIX}))
  UNION ALL
  SELECT "userId", reason FROM coin_transactions
   WHERE "refType" = 'REFERRAL' AND (starts_with(reason, ${REFERRAL_ORDER2_PREFIX}) OR starts_with(reason, ${REFERRAL_ORDER2_REVOKE_PREFIX}) OR starts_with(reason, ${LEGACY_REFERRAL_CASHBACK_PREFIX}))`;

export const BADGE_RULES: Record<BadgeId, Rule> = {
  FIRST_ORDER: (user) => Prisma.sql`
    SELECT DISTINCT o."userId" FROM orders o WHERE ${RETAIL_DELIVERED} ${user}`,
  RECYCLE_3: (user) => Prisma.sql`
    SELECT w."userId" FROM waste_requests w WHERE w.status = 'COMPLETED' ${user}
     GROUP BY w."userId" HAVING COUNT(*) >= 3`,
  REFILL_5: (user) => Prisma.sql`
    SELECT o."userId" FROM orders o
     WHERE ${RETAIL_DELIVERED} ${user}
       AND EXISTS (
         SELECT 1 FROM order_items i
          WHERE i."orderId" = o.id AND (starts_with(lower(coalesce(i."productSlug", '')), 'refill-') OR starts_with(lower(i."productName"), 'refill'))
       )
     GROUP BY o."userId" HAVING COUNT(*) >= 5`,
  STREAK_7: (user) => Prisma.sql`
    SELECT g."userId" FROM game_profiles g WHERE GREATEST(g."longestStreak", g."streakDays") >= 7 ${user}`,
  STREAK_30: (user) => Prisma.sql`
    SELECT g."userId" FROM game_profiles g WHERE GREATEST(g."longestStreak", g."streakDays") >= 30 ${user}`,
  QUIZ_PERFECT_10: (user) => Prisma.sql`
    SELECT r."userId" FROM game_play_rounds r
     WHERE r.game = 'daily_quiz' AND r."submittedAt" IS NOT NULL AND r.total >= 3 AND r.correct = r.total ${user}
     GROUP BY r."userId" HAVING COUNT(DISTINCT r."dayKey") >= 10`,
  PHOTO_REVIEW: (user) => Prisma.sql`
    SELECT DISTINCT v."userId" FROM reviews v WHERE cardinality(v.images) > 0 ${user}`,
  INVITE_1: (user) => Prisma.sql`
    SELECT t."userId" FROM (${REFERRAL_ROWS}) t WHERE true ${user}
     GROUP BY t."userId"
    HAVING SUM(CASE WHEN starts_with(t.reason, ${REFERRAL_ORDER2_REVOKE_PREFIX}) THEN -1 ELSE 1 END) >= 1`,
};

/** Bảng alias của từng câu, để lọc một khách bằng `AND <alias>."userId" = $1`. */
const BADGE_ALIAS: Record<BadgeId, string> = {
  FIRST_ORDER: 'o',
  RECYCLE_3: 'w',
  REFILL_5: 'o',
  STREAK_7: 'g',
  STREAK_30: 'g',
  QUIZ_PERFECT_10: 'r',
  PHOTO_REVIEW: 'v',
  INVITE_1: 't',
};

export function badgeUserFilter(badge: BadgeId, userId: string | null): Prisma.Sql {
  if (!userId) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`${BADGE_ALIAS[badge]}."userId"`)} = ${userId}`;
}

/** Câu cấp một huy hiệu: chèn mọi khách đạt mà chưa có dòng; chạy lại không đổi gì (khoá chính userId + badge). */
export function grantBadgeSql(badge: BadgeId, userId: string | null, now: Date): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO user_badges ("userId", badge, "earnedAt")
    SELECT q."userId", ${badge}, ${now} FROM (${BADGE_RULES[badge](badgeUserFilter(badge, userId))}) q
    ON CONFLICT DO NOTHING`;
}
