import type { Prisma, PrismaClient } from '@prisma/client';

export type UserAdminEventKind = 'ROLE' | 'STAFF_PERMISSIONS' | 'BLOCK' | 'UNBLOCK';

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
