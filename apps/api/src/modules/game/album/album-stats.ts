import { Prisma } from '@prisma/client';
import { ALBUM_GAMES, ALBUM_MASTER_DAYS, ALBUM_SPACING_DAYS, type AlbumLevel } from './album.constants';
import type { AlbumItem } from './album-cards';

/** Thống kê một mục của một khách, gộp ván thường (`game_play_rounds`) và ván ôn (`game_album_reviews`) ĐÃ NỘP. */
export interface AlbumStatRow {
  cid: string;
  seen: number;
  correct: number;
  /** Số ngày VN khác nhau có ít nhất một lần làm đúng. */
  correctDays: number;
  lastSeenDay: string;
  firstAt: Date;
  lastAt: Date;
  /** Lần làm sai gần nhất; null khi chưa sai lần nào. */
  lastWrongAt: Date | null;
}

/**
 * Một câu cho cả hai bảng, lọc theo khách trước khi bung mảng (`unnest`) để dùng chỉ mục (userId, ...) của từng bảng. Mục không thuộc game có vào
 * sổ (câu Đố Xanh cũ `gq:`) vẫn ra ở đây và bị loại khi ghép với danh sách mục ở service.
 */
export function albumStatsSql(userId: string): Prisma.Sql {
  const games = Prisma.join(ALBUM_GAMES);
  return Prisma.sql`
    WITH t AS (
      SELECT c.cid, (c.cid = ANY(r."correctIds")) AS ok, r."dayKey", r."submittedAt" AS at
        FROM game_play_rounds r CROSS JOIN LATERAL unnest(r."contentIds") AS c(cid)
       WHERE r."userId" = ${userId} AND r."submittedAt" IS NOT NULL AND r.game IN (${games})
      UNION ALL
      SELECT c.cid, (c.cid = ANY(a."correctIds")) AS ok, a."dayKey", a."submittedAt" AS at
        FROM game_album_reviews a CROSS JOIN LATERAL unnest(a."contentIds") AS c(cid)
       WHERE a."userId" = ${userId} AND a."submittedAt" IS NOT NULL
    )
    SELECT cid,
           COUNT(*)::int AS seen,
           (COUNT(*) FILTER (WHERE ok))::int AS correct,
           (COUNT(DISTINCT "dayKey") FILTER (WHERE ok))::int AS "correctDays",
           MAX("dayKey") AS "lastSeenDay",
           MIN(at) AS "firstAt",
           MAX(at) AS "lastAt",
           MAX(at) FILTER (WHERE NOT ok) AS "lastWrongAt"
      FROM t
     GROUP BY cid`;
}

export function levelOf(row: Pick<AlbumStatRow, 'seen' | 'correct' | 'correctDays'> | undefined): AlbumLevel {
  if (!row || row.seen <= 0) return 0;
  if (row.correctDays >= ALBUM_MASTER_DAYS) return 3;
  return row.correct > 0 ? 2 : 1;
}

/** Ngày VN `days` ngày trước `dayKey` ('YYYY-MM-DD'). */
export function dayKeyMinus(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Thứ tự mục tới hạn ôn (chưa cắt theo số câu một ván): trước hết mục mà lần làm gần nhất là SAI (mới sai nhất trước), rồi mục bậc 1–2 chưa gặp lại
 * từ `ALBUM_SPACING_DAYS` ngày (lâu chưa gặp nhất trước). Bỏ mục đã vào một ván ôn hôm nay, mục admin đã tắt và mục không còn trong sổ.
 */
export function reviewCandidates(
  stats: readonly AlbumStatRow[],
  items: ReadonlyMap<string, AlbumItem>,
  today: string,
  reviewedToday: ReadonlySet<string>,
): string[] {
  const usable = stats.filter((s) => items.get(s.cid)?.active === true && !reviewedToday.has(s.cid));
  const wrongLast = usable
    .filter((s) => s.lastWrongAt !== null && s.lastWrongAt.getTime() === s.lastAt.getTime())
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || byId(a.cid, b.cid));
  const first = new Set(wrongLast.map((s) => s.cid));
  const cutoff = dayKeyMinus(today, ALBUM_SPACING_DAYS);
  const spaced = usable
    .filter((s) => !first.has(s.cid) && levelOf(s) < 3 && s.lastSeenDay <= cutoff)
    .sort((a, b) => (a.lastSeenDay < b.lastSeenDay ? -1 : a.lastSeenDay > b.lastSeenDay ? 1 : byId(a.cid, b.cid)));
  return [...wrongLast, ...spaced].map((s) => s.cid);
}

/** Số mục có trong sổ của ván `contentIds` lần đầu xuất hiện ở chính ván đó (nộp lúc `submittedAt`). */
export function newCardsIn(
  contentIds: readonly string[],
  submittedAt: Date,
  stats: ReadonlyMap<string, AlbumStatRow>,
  items: ReadonlyMap<string, AlbumItem>,
): number {
  return [...new Set(contentIds)].filter((id) => items.has(id) && stats.get(id)?.firstAt.getTime() === submittedAt.getTime()).length;
}
