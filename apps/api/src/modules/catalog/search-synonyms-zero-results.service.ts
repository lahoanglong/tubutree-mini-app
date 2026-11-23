import { isShareableSearchTerm } from '@tubutree/shared-types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { foldVietnamese } from './search-text';

export const ZERO_RESULT_DEFAULT_DAYS = 14;
export const ZERO_RESULT_MAX_DAYS = 90;
/** Số cụm trả về cho thẻ admin. */
export const ZERO_RESULT_LIMIT = 30;
/** SQL lấy dư để lọc TS (`isZeroResultCandidate`) bỏ bớt mà vẫn đủ `ZERO_RESULT_LIMIT` cụm. */
const SQL_LIMIT = ZERO_RESULT_LIMIT * 2;
/** Cùng biên một vế từ đồng nghĩa (`normalizePair`, `@MaxLength(60)`): cụm ngoài biên không tạo được từ đồng nghĩa nên không bày. */
export const ZERO_RESULT_TERM_MIN = 2;
export const ZERO_RESULT_TERM_MAX = 60;
/** Một chữ dài hơn chừng này (đã gấp dấu) không phải tên hàng mà là chuỗi gõ bừa, mã hay link dán nhầm. */
export const ZERO_RESULT_WORD_MAX = 25;
/** Đồng hồ máy khách lệch: sự kiện ghi giờ tương lai quá mốc này thì bỏ. */
const FUTURE_SKEW_MS = 86_400_000;

export interface ZeroResultTerm {
  /** Cách viết (chữ thường) hay gặp nhất của cụm. */
  term: string;
  /** Số lượt tìm ra trống trong khung ngày. */
  count: number;
  /** Số người khác nhau (tài khoản, mã ẩn danh hoặc mã phiên). */
  people: number;
  lastSeenAt: string;
  /** Từ đồng nghĩa đã có cho cụm này (khớp dạng gấp dấu), kể cả dòng đang tắt. */
  synonym: { canonical: string; isActive: boolean } | null;
}

/** `?days=` của admin: số nguyên 1..90, sai hay thiếu thì 14. */
export function zeroResultDays(raw: unknown): number {
  const n = typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(ZERO_RESULT_MAX_DAYS, n) : ZERO_RESULT_DEFAULT_DAYS;
}

/**
 * Cụm được bày cho admin: qua `isShareableSearchTerm` (không email, không dãy từ 6 chữ số như SĐT), dài 2..60 ký tự sau khi gấp dấu,
 * có ít nhất một chữ cái, không phải link, không có chữ nào dài quá `ZERO_RESULT_WORD_MAX`. Sự kiện cũ ghi trước khi API lọc lúc nhận
 * vẫn qua lớp lọc này.
 */
export function isZeroResultCandidate(term: string): boolean {
  if (!isShareableSearchTerm(term) || term.trim().length > ZERO_RESULT_TERM_MAX) return false;
  const folded = foldVietnamese(term);
  if (folded.length < ZERO_RESULT_TERM_MIN || folded.length > ZERO_RESULT_TERM_MAX) return false;
  if (!/\p{L}/u.test(folded) || /https?:|www\.|:\/\//.test(folded)) return false;
  return folded.split(' ').every((w) => w.length <= ZERO_RESULT_WORD_MAX);
}

/**
 * Cụm khách tìm ra trống (`search_zero_result`) trong khung [since, until], gộp theo dạng gấp dấu (`vn_search_fold`, cùng bảng với
 * `foldVietnamese` và cột `search_synonyms.term`). Bỏ cụm có `@` hay dãy ≥ 6 chữ số ngay trong SQL như `popularSql`; mọi giá trị là tham số.
 */
export function zeroResultSql(since: Date, until: Date, limit = SQL_LIMIT): Prisma.Sql {
  return Prisma.sql`
    SELECT g.k AS "key", g.display AS "term", g.hits::int AS "count", g.people::int AS "people", g.last_seen AS "lastSeenAt"
    FROM (
      SELECT s.k, mode() WITHIN GROUP (ORDER BY s.q) AS display, COUNT(*) AS hits, COUNT(DISTINCT s.who) AS people, MAX(s.at) AS last_seen
      FROM (
        SELECT vn_search_fold(e.props->>'q') AS k,
          lower(btrim(regexp_replace(e.props->>'q', '[[:space:]]+', ' ', 'g'))) AS q,
          COALESCE(e."userId", e."anonymousId", e."sessionId") AS who,
          e."occurredAt" AS at
        FROM analytics_events e
        WHERE e."eventName" = 'search_zero_result'
          AND e."occurredAt" >= ${since}
          AND e."occurredAt" <= ${until}
          AND jsonb_typeof(e.props->'q') = 'string'
      ) s
      WHERE length(s.k) BETWEEN ${ZERO_RESULT_TERM_MIN} AND ${ZERO_RESULT_TERM_MAX}
        AND position('@' in s.q) = 0
        AND regexp_replace(s.q, '[^[:alnum:]]', '', 'g') !~ '[0-9]{6,}'
      GROUP BY s.k
    ) g
    ORDER BY g.hits DESC, g.people DESC, g.last_seen DESC, g.k ASC
    LIMIT ${limit}`;
}

interface ZeroResultSqlRow {
  key: string;
  term: string;
  count: number;
  people: number;
  lastSeenAt: Date;
}

@Injectable()
export class SearchZeroResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Top `ZERO_RESULT_LIMIT` cụm tìm ra trống trong `days` ngày, kèm từ đồng nghĩa đã có (nếu có). Chỉ ADMIN đọc (controller). */
  async report(days: number, now = new Date()): Promise<{ days: number; items: ZeroResultTerm[] }> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const until = new Date(now.getTime() + FUTURE_SKEW_MS);
    const rows = await this.prisma.$queryRaw<ZeroResultSqlRow[]>(zeroResultSql(since, until));
    // NFC: chữ gõ kiểu tổ hợp (dấu rời) dài hơn chữ dựng sẵn, mà cụm này được dán thẳng vào ô từ đồng nghĩa (tối đa 60 ký tự).
    const kept = rows
      .map((r) => ({ ...r, term: typeof r.term === 'string' ? r.term.normalize('NFC') : '' }))
      .filter((r) => isZeroResultCandidate(r.term))
      .slice(0, ZERO_RESULT_LIMIT);
    const synonyms = kept.length
      ? await this.prisma.searchSynonym.findMany({ where: { term: { in: kept.map((r) => r.key) } }, select: { term: true, canonical: true, isActive: true } })
      : [];
    const byTerm = new Map(synonyms.map((s) => [s.term, { canonical: s.canonical, isActive: s.isActive }]));
    return {
      days,
      items: kept.map((r) => ({
        term: r.term,
        count: Number(r.count),
        people: Number(r.people),
        lastSeenAt: new Date(Math.min(new Date(r.lastSeenAt).getTime(), now.getTime())).toISOString(),
        synonym: byTerm.get(r.key) ?? null,
      })),
    };
  }
}
