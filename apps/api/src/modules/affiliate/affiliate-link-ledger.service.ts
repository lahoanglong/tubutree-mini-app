import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LINK_STATS_INT4_MAX } from './affiliate-link-stats';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Khoá advisory theo transaction của lệnh tính lại (quy ước pg_advisory_xact_lock(hashtext(...)) của repo). */
export const LINK_RECOMPUTE_LOCK_KEY = 'affiliate.link_stats_recompute';
export const LINK_RECOMPUTE_ACTION = 'AFFILIATE_LINK_RECOMPUTE';
/** Số dòng tối đa trả về màn/curl và ghi vào sổ thao tác; số đếm vẫn đủ. */
export const LINK_RECOMPUTE_ROWS_MAX = 200;

const INT4_MAX = LINK_STATS_INT4_MAX;

interface TruthRow {
  id: string;
  shortCode: string;
  userId: string;
  conversions: number;
  revenue: number;
  trueConversions: bigint | number;
  trueRevenue: bigint | number;
}

/** Một link lệch (hoặc chạm trần) so với sổ hoa hồng. `trueRevenue` là doanh số thật, có thể vượt trần cột. */
export interface LinkStatsDrift {
  id: string;
  shortCode: string;
  userId: string;
  conversions: { from: number; to: number };
  revenue: { from: number; to: number };
  trueRevenue: number;
  /** Doanh số thật vượt trần int4: cột chỉ ghi được trần, số trên màn CTV thấp hơn thật. */
  saturated: boolean;
  /** Số trong cột khác số đúng (kẹp trần) — cần ghi lại. false khi chỉ chạm trần mà cột đã ở trần. */
  changed: boolean;
}

export type LinkRecomputeRowStatus = 'WILL_FIX' | 'FIXED' | 'BUSY' | 'AT_CAP';

export interface LinkRecomputeRow extends Omit<LinkStatsDrift, 'id' | 'changed'> {
  status: LinkRecomputeRowStatus;
}

export interface LinkRecomputeResult {
  dryRun: boolean;
  /** Số link đã xét (mọi link). */
  scanned: number;
  /** Số link lệch cần ghi lại (dry-run) hoặc đã ghi lại (áp). */
  fixed: number;
  /** Số link chạm trần int4 (doanh số thật vượt cột). */
  saturated: number;
  /** Lượt áp: số link đang có giao dịch khác giữ khoá dòng nên bỏ qua (chạy lại sau). */
  busy: number;
  rows: LinkRecomputeRow[];
  truncated: boolean;
  auditLogId: string | null;
}

/**
 * Số đúng của từng link theo bất biến của affiliate-link-stats.ts: đếm và cộng nền doanh số (`commissionableTotal`, sàn 0 như lúc cộng)
 * các dòng hoa hồng chưa REJECTED của đơn mang mã link đó và thuộc đúng CTV chủ link. Chỉ trả link lệch hoặc chạm trần. `ids` giới hạn
 * theo danh sách link (lượt áp đọc lại sau khi khoá dòng).
 */
async function linkTruthRows(db: Db, ids?: string[]): Promise<TruthRow[]> {
  const scope = ids ? Prisma.sql`WHERE l."id" = ANY(${ids}::text[])` : Prisma.empty;
  return db.$queryRaw<TruthRow[]>`
    SELECT t.* FROM (
      SELECT l."id", l."shortCode", l."userId", l."conversions", l."revenue",
             COALESCE(s.n, 0)::bigint AS "trueConversions",
             COALESCE(s.rev, 0)::bigint AS "trueRevenue"
        FROM "affiliate_links" AS l
        LEFT JOIN LATERAL (
          SELECT count(*) AS n, sum(GREATEST(c."commissionableTotal", 0)) AS rev
            FROM "orders" AS o
            JOIN "commissions" AS c ON c."orderId" = o."id" AND c."affiliateUserId" = l."userId"
           WHERE o."affiliateLinkCode" = l."shortCode"
             AND c."status" <> 'REJECTED'
        ) AS s ON true
      ${scope}
    ) AS t
    WHERE t."conversions" <> LEAST(t."trueConversions", ${INT4_MAX}::bigint)
       OR t."revenue" <> LEAST(t."trueRevenue", ${INT4_MAX}::bigint)
       OR t."trueRevenue" > ${INT4_MAX}::bigint
    ORDER BY t."id"`;
}

function toDrift(r: TruthRow): LinkStatsDrift {
  const trueConversions = Number(r.trueConversions);
  const trueRevenue = Number(r.trueRevenue);
  const to = { conversions: Math.min(trueConversions, INT4_MAX), revenue: Math.min(trueRevenue, INT4_MAX) };
  return {
    id: r.id,
    shortCode: r.shortCode,
    userId: r.userId,
    conversions: { from: r.conversions, to: to.conversions },
    revenue: { from: r.revenue, to: to.revenue },
    trueRevenue,
    saturated: trueRevenue > INT4_MAX || trueConversions > INT4_MAX,
    changed: r.conversions !== to.conversions || r.revenue !== to.revenue,
  };
}

/** Các link lệch sổ hoa hồng hoặc chạm trần (chỉ đọc): dùng cho xem trước và cho kiểm lệch sổ mỗi đêm. */
export async function findLinkStatsDrift(db: Db): Promise<LinkStatsDrift[]> {
  return (await linkTruthRows(db)).map(toDrift);
}

const row = (d: LinkStatsDrift, status: LinkRecomputeRowStatus): LinkRecomputeRow => {
  const { id: _id, changed: _changed, ...rest } = d;
  return { ...rest, status };
};

/**
 * Tính lại số đơn/doanh số của mọi link CTV từ sổ hoa hồng (`affiliate_links.conversions` / `revenue`), cho lúc số link lệch: rollback image về
 * bản chưa trừ link khi huỷ/trả, sửa tay, hay link chạm trần int4 rồi bị trừ trên số đã kẹp. Mặc định chỉ xem trước.
 *
 * Lượt áp chạy trong một transaction:
 *  1. `pg_try_advisory_xact_lock`: lượt thứ hai chạy chồng nhận 409 thay vì xếp hàng ghi đè nhau.
 *  2. Đọc các link lệch (không khoá), rồi khoá đúng các dòng đó `FOR UPDATE SKIP LOCKED`: dòng đang bị giao dịch khác giữ (checkout, huỷ/trả
 *     đơn đang cộng/trừ link) bị bỏ qua và báo BUSY, nên lệnh này không bao giờ chờ khoá dòng và không thể deadlock với các đường đó.
 *  3. Đọc lại số đúng cho các dòng đã khoá bằng câu lệnh mới (READ COMMITTED: thấy mọi giao dịch đã commit trước lúc khoá), rồi ghi. Giao dịch
 *     nào đã đổi dòng hoa hồng mà chưa tới bước cộng/trừ link thì đang chờ khoá dòng của lệnh này: nó cộng/trừ sau khi lệnh commit, trên số
 *     đã tính lại không gồm phần của nó, nên không đếm đôi và không mất lượt.
 *  4. Ghi sổ thao tác quản trị (`admin_audit_logs`) cùng transaction.
 * Gọi lại khi không còn lệch không ghi gì (idempotent).
 */
@Injectable()
export class AffiliateLinkLedgerService {
  private readonly logger = new Logger(AffiliateLinkLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recompute(actorId: string, opts: { dryRun?: boolean } = {}): Promise<LinkRecomputeResult> {
    const dryRun = opts.dryRun !== false;
    if (dryRun) {
      const [scanned, drift] = await Promise.all([this.prisma.affiliateLink.count(), findLinkStatsDrift(this.prisma)]);
      const rows = drift.map((d) => row(d, d.changed ? 'WILL_FIX' : 'AT_CAP'));
      return this.result({ dryRun, scanned, rows, fixed: drift.filter((d) => d.changed).length, saturated: drift.filter((d) => d.saturated).length, busy: 0, auditLogId: null });
    }

    const out = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LINK_RECOMPUTE_LOCK_KEY})) AS "locked"`;
        if (!lock?.locked) throw new ConflictException('Đang có một lượt tính lại số link CTV khác chạy. Bạn đợi ít phút rồi thử lại nhé.');
        const scanned = await tx.affiliateLink.count();
        const candidates = await findLinkStatsDrift(tx);
        const wanted = candidates.filter((d) => d.changed).map((d) => d.id);
        const locked = wanted.length
          ? (await tx.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "affiliate_links" WHERE "id" = ANY(${wanted}::text[]) ORDER BY "id" FOR UPDATE SKIP LOCKED`).map((r) => r.id)
          : [];
        const lockedSet = new Set(locked);
        const fresh = locked.length ? (await linkTruthRows(tx, locked)).map(toDrift) : [];
        const writes = fresh.filter((d) => d.changed);
        if (writes.length > 0) {
          await tx.$executeRaw`
            UPDATE "affiliate_links" AS l
               SET "conversions" = t.c, "revenue" = t.r
              FROM (SELECT unnest(${writes.map((d) => d.id)}::text[]) AS id,
                           unnest(${writes.map((d) => d.conversions.to)}::int[]) AS c,
                           unnest(${writes.map((d) => d.revenue.to)}::int[]) AS r) AS t
             WHERE l."id" = t.id`;
        }
        // Số đọc lại sau khi khoá thay cho số đọc trước; dòng đã khoá mà đọc lại không còn lệch thì bỏ. Dòng không khoá giữ số đọc trước.
        const freshById = new Map(fresh.map((d) => [d.id, d]));
        const merged = candidates.flatMap((d) => (lockedSet.has(d.id) ? (freshById.has(d.id) ? [freshById.get(d.id)!] : []) : [d]));
        const busy = candidates.filter((d) => d.changed && !lockedSet.has(d.id));
        // Link chạm trần mà cột đã ở trần: không ghi gì, chỉ báo.
        const atCap = merged.filter((d) => !d.changed && d.saturated);
        const rows = [...writes.map((d) => row(d, 'FIXED')), ...busy.map((d) => row(d, 'BUSY')), ...atCap.map((d) => row(d, 'AT_CAP'))];
        const saturated = merged.filter((d) => d.saturated).length;
        const log = await tx.adminAuditLog.create({
          data: {
            actorId,
            action: LINK_RECOMPUTE_ACTION,
            targetType: 'AFFILIATE_LINK',
            targetIds: writes.map((d) => d.shortCode).slice(0, LINK_RECOMPUTE_ROWS_MAX),
            payload: {
              scanned,
              fixed: writes.length,
              busy: busy.length,
              saturated,
              rows: rows.slice(0, LINK_RECOMPUTE_ROWS_MAX) as unknown as Prisma.InputJsonValue,
            },
          },
          select: { id: true },
        });
        return { scanned, rows, fixed: writes.length, saturated, busy: busy.length, auditLogId: log.id };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    if (out.fixed > 0 || out.busy > 0) {
      this.logger.log(`Tính lại số link CTV (admin ${actorId}): ghi lại ${out.fixed} link, ${out.busy} link đang bận bỏ qua, ${out.saturated} link chạm trần int4.`);
    }
    return this.result({ dryRun, ...out });
  }

  private result(r: Omit<LinkRecomputeResult, 'truncated' | 'rows'> & { rows: LinkRecomputeRow[] }): LinkRecomputeResult {
    return { ...r, rows: r.rows.slice(0, LINK_RECOMPUTE_ROWS_MAX), truncated: r.rows.length > LINK_RECOMPUTE_ROWS_MAX };
  }
}
