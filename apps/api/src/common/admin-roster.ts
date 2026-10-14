import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Luật "luôn còn ít nhất một quản trị viên hoạt động" (role ADMIN, không bị khoá). Mọi thao tác có thể bớt một admin
 * hoạt động — đổi vai trò, thu hồi quyền, khoá tài khoản, duyệt hồ sơ đại lý của một admin — gọi lockAdminRoster
 * đầu transaction rồi mới đọc vai trò người bị đổi và đếm. Không khoá thì hai admin cuối cùng hạ / khoá nhau cùng
 * lúc đều đếm thấy "còn 2", cả hai cùng được ghi và tổ chức mất quyền vào trang quản trị (chỉ sửa được bằng SQL).
 */
export const ADMIN_ROSTER_LOCK_KEY = 'admin-roster';

export async function lockAdminRoster(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_ROSTER_LOCK_KEY}))`;
}

export const LAST_ADMIN_MESSAGE = {
  demote: 'Đây là quản trị viên cuối cùng — cấp quyền cho người khác trước khi hạ.',
  revoke: 'Đây là quản trị viên cuối cùng — cấp quyền cho người khác trước khi thu hồi.',
  block: 'Đây là quản trị viên cuối cùng còn hoạt động — cấp quyền cho người khác trước khi khoá tài khoản này.',
  dealer: 'Người nộp hồ sơ là quản trị viên cuối cùng — cấp quyền cho người khác trước khi duyệt làm đại lý.',
} as const;

/** Gọi sau lockAdminRoster, trong cùng transaction: ngoài `userId` còn admin hoạt động nào không. */
export async function assertAnotherActiveAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
  message: string,
): Promise<void> {
  const others = await tx.user.count({ where: { role: 'ADMIN', isBlocked: false, id: { not: userId } } });
  if (others === 0) throw new BadRequestException(message);
}
