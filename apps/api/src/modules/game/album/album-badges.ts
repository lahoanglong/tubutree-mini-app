import { Prisma } from '@prisma/client';
import type { AlbumBadgeId } from '@tubutree/shared-types';
import { ALBUM_GAMES, ALBUM_MASTER_DAYS } from './album.constants';

/** Ngưỡng của huy hiệu "thuộc 10 thẻ". */
export const ALBUM_MASTER_10 = 10;

/**
 * Thẻ đã thuộc theo khách: mục của game có vào sổ, đã kiểm nguồn, làm đúng ở ít nhất `ALBUM_MASTER_DAYS` ngày VN khác nhau (ván thường và ván ôn đã
 * nộp). Cùng định nghĩa bậc 3 với `levelOf` (album-stats.ts); spec Postgres so hai đường. `user` lọc một khách (rỗng: mọi khách, cho job).
 */
function masteredCte(user: Prisma.Sql): Prisma.Sql {
  const games = Prisma.join(ALBUM_GAMES);
  return Prisma.sql`
    attempts AS (
      SELECT r."userId", c.cid, r."dayKey"
        FROM game_play_rounds r CROSS JOIN LATERAL unnest(r."correctIds") AS c(cid)
       WHERE r."submittedAt" IS NOT NULL AND r.game IN (${games}) ${user}
      UNION ALL
      SELECT r."userId", c.cid, r."dayKey"
        FROM game_album_reviews r CROSS JOIN LATERAL unnest(r."correctIds") AS c(cid)
       WHERE r."submittedAt" IS NOT NULL ${user}
    ),
    mastered AS (
      SELECT a."userId", a.cid, i.game, i.active
        FROM attempts a JOIN game_content_items i ON i.id = a.cid
       WHERE i.game IN (${games}) AND i."sourceCheckedAt" IS NOT NULL
       GROUP BY a."userId", a.cid, i.game, i.active
      HAVING COUNT(DISTINCT a."dayKey") >= ${ALBUM_MASTER_DAYS}
    ),
    totals AS (
      SELECT i.game, COUNT(*)::int AS n FROM game_content_items i
       WHERE i.active AND i."sourceCheckedAt" IS NOT NULL AND i.game IN (${games})
       GROUP BY i.game
    )`;
}

/**
 * Mỗi huy hiệu là MỘT câu SELECT trả các "userId" đã đạt (như `BADGE_RULES` của badges.ts). Chỉ đọc. "Trọn một chủ đề" và "cả sổ" so với mục ĐANG
 * bật: mục admin tắt không còn ở mẫu số; chủ đề không có mục nào đang bật thì không tính là đã trọn.
 */
export const ALBUM_BADGE_RULES: Record<AlbumBadgeId, (user: Prisma.Sql) => Prisma.Sql> = {
  ALBUM_MASTER_10: (user) => Prisma.sql`
    WITH ${masteredCte(user)}
    SELECT m."userId" FROM mastered m GROUP BY m."userId" HAVING COUNT(*) >= ${ALBUM_MASTER_10}`,
  ALBUM_TOPIC: (user) => Prisma.sql`
    WITH ${masteredCte(user)}
    SELECT DISTINCT x."userId" FROM (
      SELECT m."userId" FROM mastered m JOIN totals t ON t.game = m.game
       WHERE m.active GROUP BY m."userId", m.game, t.n HAVING COUNT(*) >= t.n
    ) x`,
  ALBUM_ALL: (user) => Prisma.sql`
    WITH ${masteredCte(user)}
    SELECT m."userId" FROM mastered m
     WHERE m.active
     GROUP BY m."userId"
    HAVING COUNT(*) >= (SELECT COALESCE(SUM(n), 0) FROM totals) AND (SELECT COALESCE(SUM(n), 0) FROM totals) > 0`,
};

export function albumUserFilter(userId: string | null): Prisma.Sql {
  return userId ? Prisma.sql`AND r."userId" = ${userId}` : Prisma.empty;
}

/** Câu cấp một huy hiệu sổ: chèn khách đạt mà chưa có dòng; chạy lại không đổi gì (khoá chính userId + badge). */
export function grantAlbumBadgeSql(badge: AlbumBadgeId, userId: string | null, now: Date): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO user_badges ("userId", badge, "earnedAt")
    SELECT q."userId", ${badge}, ${now} FROM (${ALBUM_BADGE_RULES[badge](albumUserFilter(userId))}) q
    ON CONFLICT DO NOTHING`;
}
