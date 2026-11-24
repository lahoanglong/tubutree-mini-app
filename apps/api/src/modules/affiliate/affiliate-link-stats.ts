import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Khuôn mã link CTV (`AffiliateLink.shortCode`, `?l=`): cùng khuôn `LINK_CODE_PATTERN` của hai app và `affiliate-deep-link.ts`. */
export const LINK_CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Trần cột Int 4 byte `affiliate_links.conversions` / `revenue` (không đổi cột để giữ 0 migration). */
export const LINK_STATS_INT4_MAX = 2_147_483_647;
const INT4_MAX = LINK_STATS_INT4_MAX;

/** Đường gọi lệnh tính lại số link từ sổ hoa hồng (affiliate-link-ledger.controller.ts), in trong cảnh báo cho người trực. */
export const LINK_RECOMPUTE_HINT = 'POST /admin/affiliate-links/recompute (dryRun trước)';

const logger = new Logger('AffiliateLinkStats');

type AdjustedRow = { shortCode: string; rawConversions: bigint | number; rawRevenue: bigint | number };

/**
 * Cảnh báo ops khi phép cộng/trừ bị kẹp: vượt trần int4 nghĩa là số của link từ đây báo thấp hơn thật (cột không chứa nổi), xuống dưới 0
 * nghĩa là số link đã lệch sổ hoa hồng từ trước (rollback image, sửa tay). Chỉ ghi log trong tx, không gửi tin: nightly `LedgerDriftCron`
 * báo admin số link lệch/chạm trần.
 */
function warnIfClamped(rows: AdjustedRow[]): void {
  for (const r of rows) {
    const conv = Number(r.rawConversions);
    const rev = Number(r.rawRevenue);
    if (conv > INT4_MAX || rev > INT4_MAX) {
      logger.warn(`Link CTV ${r.shortCode} vượt trần int4 (${INT4_MAX}), số đơn/doanh số đã kẹp ở trần và từ đây báo thấp hơn thật. Tính lại: ${LINK_RECOMPUTE_HINT}.`);
    } else if (conv < 0 || rev < 0) {
      logger.warn(`Link CTV ${r.shortCode} bị trừ xuống dưới 0 (đã kẹp về 0): số link lệch sổ hoa hồng từ trước. Tính lại: ${LINK_RECOMPUTE_HINT}.`);
    }
  }
}

/**
 * Số đơn và doanh số của một link CTV (`affiliate_links.conversions` / `revenue`) đi theo vòng đời dòng hoa hồng của đơn mang mã link đó
 * (`orders.affiliateLinkCode`): dòng hoa hồng vừa tạo thì +1 đơn và + nền doanh số (`commissionableTotal`); dòng rời trạng thái sống
 * (→ REJECTED: huỷ đơn, trả cả đơn, lệnh rút bị từ chối của đơn đã đóng, admin huỷ hoa hồng của CTV bị thu hồi) thì −1 đơn và − phần nền còn
 * lại; trả một phần thì chỉ − phần nền bị cắt. Bất biến: số của link = đếm và cộng `commissionableTotal` các dòng hoa hồng chưa REJECTED của
 * những đơn mang mã link đó, cùng định nghĩa "đơn" với `dashboard().totalConversions`.
 *
 * Gọi CHỈ ở chỗ vừa đổi được dòng hoa hồng (createMany trả count 1, update dưới khoá dòng, updateMany có điều kiện trả count 1), trong cùng tx:
 * gọi lại hay hai tx song song không cộng/trừ hai lần vì phép đổi trạng thái đó chỉ thành công một lần. Câu UPDATE tự khoá dòng link nên hai
 * đơn cùng link cộng song song không mất lượt. Trừ có sàn 0 (GREATEST) để số liệu cũ lệch không thành số âm trên màn CTV.
 *
 * Link phải thuộc đúng CTV hưởng hoa hồng (`l."userId"` = `affiliateUserId`): checkout đã kiểm khi lưu mã, đây là lớp hai.
 *
 * Trả số dòng link đã đổi (0 hoặc 1).
 */
export async function adjustLinkStats(
  db: Db,
  input: { orderId: string; affiliateUserId: string; orders: 1 | 0 | -1; revenue: number },
): Promise<number> {
  // Số lạ (NaN/Infinity) không được tới câu `::bigint`: lỗi ép kiểu làm hỏng cả transaction đặt đơn/đảo đơn đang gọi.
  const revenue = Number.isFinite(input.revenue) ? Math.trunc(input.revenue) : 0;
  if (input.orders === 0 && revenue === 0) return 0;
  // Cột Int 4 byte: cộng trên bigint rồi kẹp sàn 0 / trần int4, vì tràn số sẽ làm hỏng cả transaction đang gọi. CTE khoá dòng link
  // (FOR UPDATE, đọc bản mới nhất sau khi chờ) và giữ số chưa kẹp để RETURNING báo được lần kẹp; UPDATE ghi trên đúng dòng đã khoá.
  const rows = await db.$queryRaw<AdjustedRow[]>`
    WITH cur AS (
      SELECT l."id",
             l."conversions"::bigint + ${input.orders}::bigint AS "rawConversions",
             l."revenue"::bigint + ${revenue}::bigint AS "rawRevenue"
        FROM "affiliate_links" AS l
        JOIN "orders" AS o ON l."shortCode" = o."affiliateLinkCode"
       WHERE o."id" = ${input.orderId}
         AND o."affiliateLinkCode" IS NOT NULL
         AND l."userId" = ${input.affiliateUserId}
         FOR UPDATE OF l
    )
    UPDATE "affiliate_links" AS l
       SET "conversions" = LEAST(GREATEST(cur."rawConversions", 0), ${INT4_MAX}::bigint)::int,
           "revenue" = LEAST(GREATEST(cur."rawRevenue", 0), ${INT4_MAX}::bigint)::int
      FROM cur
     WHERE l."id" = cur."id"
    RETURNING l."shortCode" AS "shortCode", cur."rawConversions" AS "rawConversions", cur."rawRevenue" AS "rawRevenue"`;
  warnIfClamped(rows);
  return rows.length;
}

/**
 * Dòng hoa hồng của một đơn. `affiliateLinkCode` là mã link của đơn mà nơi gọi đã đọc sẵn: trống thì bỏ qua không chạy câu UPDATE (đa số đơn
 * không đến từ link). Câu UPDATE vẫn tự đọc mã của đơn từ DB, giá trị truyền vào chỉ để bỏ qua sớm.
 */
export interface CommissionLinkRow {
  orderId: string;
  affiliateUserId: string;
  commissionableTotal: number;
  affiliateLinkCode?: string | null;
}

/** Dòng hoa hồng vừa tạo: +1 đơn, + nền doanh số. */
export async function creditLinkForCommission(db: Db, c: CommissionLinkRow): Promise<number> {
  if (!c.affiliateLinkCode) return 0;
  return adjustLinkStats(db, { orderId: c.orderId, affiliateUserId: c.affiliateUserId, orders: 1, revenue: Math.max(0, c.commissionableTotal) });
}

/** Dòng hoa hồng vừa đổi REJECTED: −1 đơn, − phần nền doanh số còn lại của dòng (đã trừ các lần trả một phần). */
export async function debitLinkForRejectedCommission(db: Db, c: CommissionLinkRow): Promise<number> {
  if (!c.affiliateLinkCode) return 0;
  return adjustLinkStats(db, { orderId: c.orderId, affiliateUserId: c.affiliateUserId, orders: -1, revenue: -Math.max(0, c.commissionableTotal) });
}

/** Trả một phần: nền doanh số của dòng hoa hồng vừa giảm `baseCut`, số đơn giữ nguyên (đơn vẫn DELIVERED). */
export async function debitLinkRevenue(db: Db, c: { orderId: string; affiliateUserId: string; baseCut: number; affiliateLinkCode?: string | null }): Promise<number> {
  if (!c.affiliateLinkCode || c.baseCut <= 0) return 0;
  return adjustLinkStats(db, { orderId: c.orderId, affiliateUserId: c.affiliateUserId, orders: 0, revenue: -c.baseCut });
}
