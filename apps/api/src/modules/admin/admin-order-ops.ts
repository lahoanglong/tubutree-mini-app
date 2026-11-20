import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { isRealUser } from '../../common/real-user';
import { OVERDUE_CANCELLED_ID_CAP, vnDayRange } from './admin-order-filter';

/**
 * Id đơn lẻ chuyển khoản hệ thống tự huỷ vì quá hạn thanh toán (xem BANK_TRANSFER_OVERDUE_CANCELLED_WHERE), mới nhất trước, tối đa
 * OVERDUE_CANCELLED_ID_CAP. Khoảng ngày đặt (giờ VN) thu hẹp ngay ở đây để tập id không phình theo năm tháng. Cột `createdAt` là
 * timestamp không múi giờ ghi giờ UTC: mốc so sánh đổi về UTC bằng `AT TIME ZONE 'UTC'`, không phụ thuộc TimeZone của phiên.
 * Lấy dư một dòng: `capped` = còn đơn cũ hơn bị bỏ ngoài tập (ô đếm và danh sách chỉ phủ OVERDUE_CANCELLED_ID_CAP đơn mới nhất).
 */
export async function findOverdueCancelledIds(
  prisma: Pick<PrismaService, '$queryRaw'>,
  from?: string,
  to?: string,
): Promise<{ ids: string[]; capped: boolean }> {
  const range = vnDayRange(from, to);
  const gte = range?.gte instanceof Date ? range.gte.toISOString() : null;
  const lt = range?.lt instanceof Date ? range.lt.toISOString() : null;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM orders o
    WHERE o.status = 'CANCELLED' AND o."paymentMethod" = 'BANK_TRANSFER' AND o.type = 'RETAIL'
      ${gte ? Prisma.sql`AND o."createdAt" >= (${gte}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}
      ${lt ? Prisma.sql`AND o."createdAt" < (${lt}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}
      AND EXISTS (
        SELECT 1 FROM order_status_history h
        WHERE h."orderId" = o.id AND h."toStatus" = 'CANCELLED' AND h."fromStatus" = 'PENDING_PAYMENT' AND h."actorType" = 'SYSTEM'
      )
    ORDER BY o."createdAt" DESC
    LIMIT ${OVERDUE_CANCELLED_ID_CAP + 1}`;
  const capped = rows.length > OVERDUE_CANCELLED_ID_CAP;
  return { ids: (capped ? rows.slice(0, OVERDUE_CANCELLED_ID_CAP) : rows).map((r) => r.id), capped };
}

/** guest = đơn của phiên vãng lai (web không đăng nhập, hay tài khoản `guest_` của Mini App); merged = đơn vãng lai web đã gộp vào tài khoản Zalo. */
export type OrderGuestSource = 'guest' | 'merged';

export function orderGuestSource(o: { guestPhone?: string | null; user?: { phone?: string | null; zaloId?: string | null } | null }): OrderGuestSource | null {
  const real = isRealUser(o.user);
  if (o.guestPhone) return real ? 'merged' : 'guest';
  return o.user && !real ? 'guest' : null;
}

/** Lần huỷ của một đơn đã huỷ: lý do (ghi chú lịch sử), ai huỷ, và lúc huỷ — cũng là lúc giữ kho được nhả (cùng transaction). */
export interface OrderCancellationView {
  at: string;
  note: string | null;
  actorType: string;
  /** Hệ thống tự huỷ vì quá hạn thanh toán (cron hay webhook MSS payment_rescue). */
  overdue: boolean;
}

/** Dòng lịch sử huỷ mới nhất của từng đơn trong trang (một câu cho cả trang). */
export async function latestCancellations(
  prisma: Pick<PrismaService, 'orderStatusHistory'>,
  orderIds: readonly string[],
): Promise<Map<string, OrderCancellationView>> {
  const out = new Map<string, OrderCancellationView>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.orderStatusHistory.findMany({
    where: { orderId: { in: [...orderIds] }, toStatus: 'CANCELLED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { orderId: true, createdAt: true, note: true, actorType: true, fromStatus: true },
  });
  for (const r of rows) {
    if (out.has(r.orderId)) continue;
    out.set(r.orderId, {
      at: r.createdAt.toISOString(),
      note: r.note,
      actorType: r.actorType,
      overdue: r.actorType === 'SYSTEM' && r.fromStatus === 'PENDING_PAYMENT',
    });
  }
  return out;
}
