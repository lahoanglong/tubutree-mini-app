import type { Prisma } from '@prisma/client';

type RevocationDb = Pick<Prisma.TransactionClient, 'commission' | 'storefront'>;

/**
 * Dấu thu hồi quyền bán, đặt cùng lệnh đổi vai trò: chuyển về khách từ CTV/đại lý luôn đặt; từ vai trò khác (nhân viên, admin) chỉ khi
 * người đó còn dấu vết CTV (hoa hồng hoặc gian hàng CTV), vì khách thường chưa từng bán không cần dấu. Cấp lại CTV/đại lý thì xoá dấu.
 * Đổi sang nhân viên/admin không đụng tới dấu.
 */
export async function affiliateRevocationPatch(
  db: RevocationDb,
  userId: string,
  from: string,
  to: string,
): Promise<{ affiliateRevokedAt?: Date | null }> {
  if (to === 'AFFILIATE' || to === 'DEALER') return { affiliateRevokedAt: null };
  if (to !== 'CUSTOMER' || from === 'CUSTOMER') return {};
  if (from === 'AFFILIATE' || from === 'DEALER') return { affiliateRevokedAt: new Date() };
  const [commission, storefront] = await Promise.all([
    db.commission.findFirst({ where: { affiliateUserId: userId }, select: { id: true } }),
    db.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' }, select: { id: true } }),
  ]);
  return commission || storefront ? { affiliateRevokedAt: new Date() } : {};
}

/** CUSTOMER không dấu cũng bị chặn: CTV hạ trước khi có dấu, hay đi qua nhân viên, không còn quyền rút hoa hồng/nhận thưởng. */
export function isAffiliateBlocked(user: { role: string; affiliateRevokedAt: Date | null } | null): boolean {
  return !user || user.affiliateRevokedAt !== null || user.role === 'CUSTOMER';
}
