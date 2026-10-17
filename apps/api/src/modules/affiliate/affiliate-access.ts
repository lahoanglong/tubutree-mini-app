import type { Prisma, UserRole } from '@prisma/client';

/** Vai trò đăng ký CTV một chạm được (POST /affiliate/register). Đại lý, nhân viên và admin bị từ chối. */
export function canRegisterAsAffiliate(role: UserRole): boolean {
  return role === 'CUSTOMER' || role === 'AFFILIATE';
}

/**
 * Vai trò lên đơn hộ khách (hưởng hoa hồng đơn hộ). Đại lý chưa mở: mô hình bán lẻ online của đại lý chưa chốt
 * (D3-04, câu hỏi Q1), và route này từ đầu chỉ dành cho CTV (đại lý mua sỉ cho chính mình). ADMIN vào được nhưng không hưởng hoa
 * hồng (createCommissionForOrder xét vai trò người lên đơn).
 */
export function canPlaceOrderForCustomer(role: UserRole): boolean {
  return role === 'AFFILIATE' || role === 'ADMIN';
}

type AccessDb = Pick<Prisma.TransactionClient, 'storefront' | 'commission'>;

/**
 * Dùng được công cụ CTV: xem hoa hồng, rút tiền, chọn sản phẩm cho gian hàng. CTV và ADMIN luôn có. CTV được duyệt lên đại lý
 * đổi vai trò nhưng giữ gian hàng CTV và hoa hồng đã ghi (D3-03): chặn theo vai trò làm tiền vẫn cộng mà họ không xem, không rút
 * được. Đại lý chỉ cần một trong hai dấu vết đó, kể cả dòng hoa hồng đã trả hay từ chối, để còn xem sổ. Đại lý thuần thì không,
 * vì họ không đăng ký CTV được.
 */
export async function hasAffiliateAccess(db: AccessDb, user: { id: string; role: UserRole }): Promise<boolean> {
  if (user.role === 'AFFILIATE' || user.role === 'ADMIN') return true;
  if (user.role !== 'DEALER') return false;
  const [storefront, commission] = await Promise.all([
    db.storefront.findFirst({ where: { ownerUserId: user.id, type: 'CTV' }, select: { id: true } }),
    db.commission.findFirst({ where: { affiliateUserId: user.id }, select: { id: true } }),
  ]);
  return storefront !== null || commission !== null;
}
