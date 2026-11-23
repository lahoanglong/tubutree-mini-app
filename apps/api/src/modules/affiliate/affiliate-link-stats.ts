import type { Prisma } from '@prisma/client';

/** Khuôn mã link CTV (`AffiliateLink.shortCode`, `?l=`): cùng khuôn `LINK_CODE_PATTERN` của hai app và `affiliate-deep-link.ts`. */
export const LINK_CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

type Db = Pick<Prisma.TransactionClient, '$executeRaw'>;

const INT4_MAX = 2_147_483_647;

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
 */
export async function adjustLinkStats(
  db: Db,
  input: { orderId: string; affiliateUserId: string; orders: 1 | 0 | -1; revenue: number },
): Promise<number> {
  const revenue = Math.trunc(input.revenue);
  if (input.orders === 0 && revenue === 0) return 0;
  // Cột Int 4 byte: cộng trên bigint rồi kẹp trần, vì tràn số sẽ làm hỏng cả transaction đặt đơn đang gọi hàm này.
  return db.$executeRaw`
    UPDATE "affiliate_links" AS l
       SET "conversions" = LEAST(GREATEST(l."conversions"::bigint + ${input.orders}::bigint, 0), ${INT4_MAX}::bigint)::int,
           "revenue" = LEAST(GREATEST(l."revenue"::bigint + ${revenue}::bigint, 0), ${INT4_MAX}::bigint)::int
      FROM "orders" AS o
     WHERE o."id" = ${input.orderId}
       AND o."affiliateLinkCode" IS NOT NULL
       AND l."shortCode" = o."affiliateLinkCode"
       AND l."userId" = ${input.affiliateUserId}`;
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
