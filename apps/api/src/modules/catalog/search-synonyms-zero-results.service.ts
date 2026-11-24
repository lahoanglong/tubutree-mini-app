import { isShareableSearchTerm } from '@tubutree/shared-types';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { editDistance } from './search-fuzzy';
import { POPULAR_WINDOW_DAYS, SEARCH_POPULAR_TERMS_KEY, popularSql } from './search-popular.service';
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
/** Số cụm tìm thay gợi ý tối đa cho một dòng (mỗi cụm là một nút tạo từ đồng nghĩa một chạm). */
export const SUGGESTION_MAX = 2;
/** Điểm giống nhau tối thiểu (0..1, xem `suggestCanonicals`) để một cụm chuẩn được gợi ý. */
export const SUGGESTION_MIN_SCORE = 0.5;
/** Số cụm tìm phổ biến có hàng (`popularSql`) đọc thêm làm nguồn gợi ý, sau danh sách của admin. */
export const SUGGESTION_POPULAR_LIMIT = 30;

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
  /** Cụm tìm thay gợi ý (có dấu, tối đa `SUGGESTION_MAX`) để admin tạo từ đồng nghĩa một chạm; rỗng khi đã có từ đồng nghĩa. */
  suggestions: string[];
}

/** `?days=` của admin: số nguyên 1..90, sai hay thiếu thì 14. */
export function zeroResultDays(raw: unknown): number {
  const n = typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(ZERO_RESULT_MAX_DAYS, n) : ZERO_RESULT_DEFAULT_DAYS;
}

/**
 * Cụm được bày cho admin: qua `isShareableSearchTerm` (không email, không dãy từ 6 chữ số như SĐT), dài 2..60 ký tự sau khi gấp dấu,
 * có ít nhất một chữ cái, không phải link, không có chữ nào dài quá `ZERO_RESULT_WORD_MAX`. Sự kiện cũ ghi trước khi API lọc lúc nhận
 * vẫn qua lớp lọc này, kể cả chữ số toàn khổ (`０９１２…`).
 */
export function isZeroResultCandidate(term: string): boolean {
  if (!isShareableSearchTerm(term) || term.trim().length > ZERO_RESULT_TERM_MAX) return false;
  const folded = foldVietnamese(term);
  if (folded.length < ZERO_RESULT_TERM_MIN || folded.length > ZERO_RESULT_TERM_MAX) return false;
  if (!/\p{L}/u.test(folded) || /https?:|www\.|:\/\//.test(folded)) return false;
  return folded.split(' ').every((w) => w.length <= ZERO_RESULT_WORD_MAX);
}

/**
 * Cụm tìm thay gợi ý cho một cụm tìm chưa ra, lấy từ `keywords` (cụm chuẩn có dấu, ưu tiên theo thứ tự). So trên dạng gấp dấu nên "nuoc rua bat"
 * và "nước rửa bát" ra cùng gợi ý "nước rửa chén". Mỗi chữ khách gõ khớp đúng một chữ của cụm chuẩn được 1 điểm, lệch một ký tự (cả hai chữ từ
 * 4 ký tự: "granla") được 0,75; tổng chia số chữ của vế nhiều chữ hơn. Gõ dính chữ ("nuocgiat") so thêm hai vế bỏ dấu cách. Bỏ cụm chuẩn trùng
 * cụm khách gõ sau khi gấp dấu (máy chủ không nhận cặp giống nhau), cụm nằm trong `blocked` (chính nó cũng tìm chưa ra) và cụm ngoài biên 2..60.
 */
export function suggestCanonicals(term: string, keywords: readonly unknown[], blocked: ReadonlySet<string> = new Set(), max = SUGGESTION_MAX): string[] {
  const folded = foldVietnamese(term);
  const words = folded.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const seen = new Set<string>([folded]);
  const scored: { display: string; score: number; order: number }[] = [];
  keywords.forEach((raw, order) => {
    if (typeof raw !== 'string') return;
    // Cụm phổ biến lấy từ SQL `lower()` (collation C) còn giữ chữ hoa có dấu: hạ lại như cụm tìm chưa ra.
    const display = raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
    const key = foldVietnamese(display);
    if (key.length < ZERO_RESULT_TERM_MIN || key.length > ZERO_RESULT_TERM_MAX || seen.has(key) || blocked.has(key)) return;
    seen.add(key);
    const score = similarity(words, key);
    if (score >= SUGGESTION_MIN_SCORE) scored.push({ display, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map((s) => s.display);
}

function similarity(words: readonly string[], key: string): number {
  const other = key.split(' ');
  const used = new Set<number>();
  let hit = 0;
  for (const w of words) {
    let best = -1;
    let bestScore = 0;
    other.forEach((k, i) => {
      if (used.has(i)) return;
      const s = w === k ? 1 : w.length >= 4 && k.length >= 4 && editDistance(w, k, 1) <= 1 ? 0.75 : 0;
      if (s > bestScore) {
        best = i;
        bestScore = s;
      }
    });
    if (best >= 0) {
      used.add(best);
      hit += bestScore;
    }
  }
  const score = hit / Math.max(words.length, other.length);
  const joined = words.join('');
  return joined.length >= 4 && editDistance(joined, other.join(''), 1) <= 1 ? Math.max(score, 0.9) : score;
}

/**
 * Cụm khách tìm ra trống (`search_zero_result`) trong khung [since, until], gộp theo dạng gấp dấu (`vn_search_fold`, cùng bảng với
 * `foldVietnamese` và cột `search_synonyms.term`). Bỏ cụm có `@` hay dãy ≥ 6 chữ số ngay trong SQL như `popularSql`, và lọc rác (không có chữ
 * cái, link, chữ quá dài) trước LIMIT để ai đó bơm sự kiện rác không chiếm hết chỗ của cụm thật; mọi giá trị là tham số.
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
        AND s.k ~ '[a-z]'
        AND s.k !~ '(https?:|www[.]|://)'
        AND s.k !~ ${`[^ ]{${ZERO_RESULT_WORD_MAX + 1},}`}
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
  private readonly logger = new Logger(SearchZeroResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /**
   * Top `ZERO_RESULT_LIMIT` cụm tìm ra trống trong `days` ngày, kèm từ đồng nghĩa đã có (nếu có) hoặc cụm tìm thay gợi ý. Chỉ ADMIN đọc
   * (controller).
   */
  async report(days: number, now = new Date()): Promise<{ days: number; items: ZeroResultTerm[] }> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const until = new Date(now.getTime() + FUTURE_SKEW_MS);
    const rows = await this.prisma.$queryRaw<ZeroResultSqlRow[]>(zeroResultSql(since, until));
    // NFC: chữ gõ kiểu tổ hợp (dấu rời) dài hơn chữ dựng sẵn, mà cụm này được dán thẳng vào ô từ đồng nghĩa (tối đa 60 ký tự).
    // `lower()` của Postgres theo collation C không hạ chữ hoa có dấu (`NƯỚC` thành `nƯỚc`): hạ lại ở đây.
    const kept = rows
      .map((r) => ({ ...r, term: typeof r.term === 'string' ? r.term.normalize('NFC').toLocaleLowerCase('vi') : '' }))
      .filter((r) => isZeroResultCandidate(r.term))
      .slice(0, ZERO_RESULT_LIMIT);
    const synonyms = kept.length
      ? await this.prisma.searchSynonym.findMany({ where: { term: { in: kept.map((r) => r.key) } }, select: { term: true, canonical: true, isActive: true } })
      : [];
    const byTerm = new Map(synonyms.map((s) => [s.term, { canonical: s.canonical, isActive: s.isActive }]));
    const keywords = kept.some((r) => !byTerm.has(r.key)) ? await this.canonicalKeywords(now) : [];
    // Cụm chuẩn mà chính nó cũng tìm chưa ra thì tạo từ đồng nghĩa tới nó vẫn không ra món nào.
    const blocked = new Set(rows.map((r) => r.key));
    return {
      days,
      items: kept.map((r) => {
        const synonym = byTerm.get(r.key) ?? null;
        return {
          term: r.term,
          count: Number(r.count),
          people: Number(r.people),
          lastSeenAt: new Date(Math.min(new Date(r.lastSeenAt).getTime(), now.getTime())).toISOString(),
          synonym,
          suggestions: synonym ? [] : suggestCanonicals(r.term, keywords, blocked),
        };
      }),
    };
  }

  /**
   * Nguồn cụm chuẩn cho gợi ý: danh sách admin giữ ở `system_configs` (`catalog.search_popular_terms`, ô "Cụm tìm phổ biến dự phòng" cùng
   * trang) trước, rồi cụm khách tìm ra hàng nhiều nhất (`popularSql`: từ 3 người, mọi chữ có trong tên một món đang bán). Đọc lỗi thì bỏ
   * nguồn đó: bảng tìm chưa ra vẫn trả về, chỉ thiếu gợi ý.
   */
  private async canonicalKeywords(now: Date): Promise<unknown[]> {
    const [curated, popular] = await Promise.all([this.curatedKeywords(), this.popularKeywords(now)]);
    return [...curated, ...popular];
  }

  private async curatedKeywords(): Promise<unknown[]> {
    if (!this.config) return [];
    try {
      const v = await this.config.get<unknown>(SEARCH_POPULAR_TERMS_KEY, []);
      return Array.isArray(v) ? v : [];
    } catch (err) {
      this.logger.warn(`Không đọc được ${SEARCH_POPULAR_TERMS_KEY} cho gợi ý từ đồng nghĩa: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async popularKeywords(now: Date): Promise<unknown[]> {
    try {
      const since = new Date(now.getTime() - POPULAR_WINDOW_DAYS * 86_400_000);
      const rows = await this.prisma.$queryRaw<{ display: unknown }[]>(popularSql(since, SUGGESTION_POPULAR_LIMIT));
      return rows.map((r) => r.display);
    } catch (err) {
      this.logger.warn(`Không đọc được cụm tìm phổ biến cho gợi ý từ đồng nghĩa: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
