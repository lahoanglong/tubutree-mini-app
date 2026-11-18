import { isShareableSearchTerm } from '@tubutree/shared-types';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { foldVietnamese } from './search-text';

export const SEARCH_POPULAR_FLAG = 'catalog.search_popular_enabled';
export const SEARCH_POPULAR_TERMS_KEY = 'catalog.search_popular_terms';

/** Số cụm tối đa trả về (một hàng chip cuộn ngang). */
export const POPULAR_MAX = 8;
/** Dưới số cụm này thì bù bằng danh sách dự phòng. */
export const POPULAR_MIN_FROM_DATA = 4;
/** Một cụm phải có ít nhất chừng này người tìm khác nhau mới lên danh sách (không lộ cụm riêng của một khách). */
export const POPULAR_MIN_PEOPLE = 3;
export const POPULAR_WINDOW_DAYS = 14;
const CACHE_TTL_MS = 60 * 60_000;
/** Biên độ dài của một cụm (đã gấp dấu), cùng biên với luật admin của danh sách dự phòng. */
export const POPULAR_TERM_MIN = 2;
export const POPULAR_TERM_MAX = 40;
/** Trần số cụm dự phòng admin lưu được. */
export const POPULAR_FALLBACK_MAX = 12;

export function isPopularCandidate(term: string): boolean {
  const folded = foldVietnamese(term);
  return folded.length >= POPULAR_TERM_MIN && folded.length <= POPULAR_TERM_MAX && isShareableSearchTerm(term);
}

/** Gộp cụm từ dữ liệu và dự phòng theo dạng gấp dấu, giữ thứ tự, tối đa POPULAR_MAX. Dự phòng chỉ dùng khi dữ liệu chưa đủ POPULAR_MIN_FROM_DATA cụm. */
export function mergePopular(fromData: readonly string[], fallback: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: unknown) => {
    if (typeof t !== 'string' || out.length >= POPULAR_MAX) return;
    const term = t.trim().replace(/\s+/g, ' ');
    const key = foldVietnamese(term);
    if (!isPopularCandidate(term) || seen.has(key)) return;
    seen.add(key);
    out.push(term);
  };
  fromData.forEach(add);
  if (out.length < POPULAR_MIN_FROM_DATA) fallback.forEach(add);
  return out;
}

/**
 * Cụm tìm nhiều trong 14 ngày (`search_performed` có kết quả), gộp theo dạng đã gấp dấu (`vn_search_fold`), mỗi cụm ≥ 3 người khác nhau
 * (tài khoản, hoặc mã ẩn danh, hoặc mã phiên). Bỏ cụm có `@` hay dãy ≥ 6 chữ số ở cả SQL lẫn TS. Hiện cách viết (chữ thường) hay gặp nhất.
 * Mã ẩn danh và `resultsCount` do app gửi lên nên tự chúng không chặn được ai bơm cụm tuỳ ý: cụm chỉ được giữ khi mọi từ của nó có trong
 * tên một sản phẩm đang bán (cùng điều kiện công khai với `textMatchSql`).
 */
export function popularSql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT g.k, g.display, g.people
    FROM (
      SELECT s.k, mode() WITHIN GROUP (ORDER BY s.q) AS display, COUNT(DISTINCT s.who)::int AS people, COUNT(*) AS hits
      FROM (
        SELECT vn_search_fold(e.props->>'q') AS k,
          lower(btrim(regexp_replace(e.props->>'q', '[[:space:]]+', ' ', 'g'))) AS q,
          COALESCE(e."userId", e."anonymousId", e."sessionId") AS who
        FROM analytics_events e
        WHERE e."eventName" = 'search_performed'
          AND e."occurredAt" >= ${since}
          AND jsonb_typeof(e.props->'q') = 'string'
          AND CASE WHEN (e.props->>'resultsCount') ~ '^[0-9]{1,9}$' THEN (e.props->>'resultsCount')::int ELSE 0 END > 0
      ) s
      WHERE s.who IS NOT NULL
        AND length(s.k) BETWEEN ${POPULAR_TERM_MIN} AND ${POPULAR_TERM_MAX}
        AND position('@' in s.q) = 0
        AND regexp_replace(s.q, '[^[:alnum:]]', '', 'g') !~ '[0-9]{6,}'
      GROUP BY s.k
      HAVING COUNT(DISTINCT s.who) >= ${POPULAR_MIN_PEOPLE}
    ) g
    WHERE EXISTS (
      SELECT 1 FROM products p
      WHERE p."isActive" = true
        AND p."approvalStatus" = 'APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(string_to_array(g.k, ' ')) AS w(t)
          WHERE w.t <> '' AND strpos(p."nameSearch", w.t) = 0
        )
    )
    ORDER BY g.people DESC, g.hits DESC, g.k ASC
    LIMIT ${POPULAR_MAX}`;
}

@Injectable()
export class SearchPopularService {
  private readonly logger = new Logger(SearchPopularService.name);
  private cache: { terms: string[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** Cờ `catalog.search_popular_enabled` tắt thì rỗng (hai app không vẽ hàng chip). Đệm 1 giờ. */
  async popular(): Promise<{ terms: string[] }> {
    if (!(await this.flag())) return { terms: [] };
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return { terms: this.cache.terms };
    const terms = mergePopular(await this.fromData(now), await this.fallback());
    this.cache = { terms, expiresAt: now + CACHE_TTL_MS };
    return { terms };
  }

  private async flag(): Promise<boolean> {
    if (!this.config) return false;
    try {
      return (await this.config.get<boolean>(SEARCH_POPULAR_FLAG, false)) === true;
    } catch {
      return false;
    }
  }

  private async fromData(now: number): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ display: string }[]>(popularSql(new Date(now - POPULAR_WINDOW_DAYS * 86_400_000)));
      return rows.map((r) => r.display);
    } catch (err) {
      this.logger.warn(`Không đọc được từ khoá phổ biến: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async fallback(): Promise<unknown[]> {
    if (!this.config) return [];
    try {
      const v = await this.config.get<unknown>(SEARCH_POPULAR_TERMS_KEY, []);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
}
