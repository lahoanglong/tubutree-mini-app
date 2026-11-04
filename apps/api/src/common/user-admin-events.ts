import type { Prisma, PrismaClient } from '@prisma/client';

/** WALLET_FORFEIT: xoá tài khoản, số dư Ví bị trừ về 0 (from = số dư trước, to = 0); khách đã đồng ý bỏ, hoặc admin xử lý dù chưa đồng ý (reason nêu rõ, kèm lý do admin).
 * AFFILIATE_REVOKE: dấu thu hồi quyền CTV đổi giá trị (from/to = ISO của dấu, null khi không có dấu); ghi cả khi vai trò không đổi.
 * STOREFRONT_PARTNER: admin bật/tắt cờ đối tác của gian hàng do người này làm chủ (reason = id gian hàng). */
export type UserAdminEventKind = 'ROLE' | 'STAFF_PERMISSIONS' | 'BLOCK' | 'UNBLOCK' | 'STOREFRONT_PARTNER' | 'WALLET_FORFEIT' | 'AFFILIATE_REVOKE';

type Db = Pick<PrismaClient, 'userAdminEvent'> | Prisma.TransactionClient;

/**
 * Ghi một dòng vào sổ việc admin làm trên tài khoản (bảng user_admin_events) — màn chi tiết người dùng đọc lại lịch sử
 * vai trò và khoá. Gọi trong cùng transaction với thay đổi khi có, để không có thay đổi nào thiếu dòng sổ.
 */
export function recordUserAdminEvent(
  db: Db,
  e: { userId: string; kind: UserAdminEventKind; from?: string | null; to?: string | null; reason?: string | null; actorId?: string | null },
) {
  return db.userAdminEvent.create({
    data: {
      userId: e.userId,
      kind: e.kind,
      fromValue: e.from ?? null,
      toValue: e.to ?? null,
      reason: e.reason ?? null,
      actorId: e.actorId ?? null,
    },
  });
}
