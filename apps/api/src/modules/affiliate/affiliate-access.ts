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

export interface AffiliateAccess {
  /** Xem hoa hồng, rút tiền, chọn sản phẩm cho gian hàng. */
  hasAccess: boolean;
  /** Mở được trình dựng gian hàng: StorefrontService.getOrCreateMine không trả 400 cho người này. */
  canOpenStorefront: boolean;
}

/**
 * CTV và ADMIN luôn có công cụ CTV và mở/tạo được gian hàng. CTV được duyệt lên đại lý đổi vai trò nhưng giữ gian hàng CTV và
 * hoa hồng đã ghi (D3-03): chặn theo vai trò làm tiền vẫn cộng mà họ không xem, không rút được. Đại lý có công cụ khi còn một
 * trong hai dấu vết đó, kể cả dòng hoa hồng đã trả hay từ chối, để còn xem sổ; nhưng chỉ mở được gian hàng khi gian hàng CTV còn
 * đó, vì getOrCreateMine không cho đại lý tạo mới. Đại lý thuần thì không có gì, vì họ không đăng ký CTV được.
 */
export async function affiliateAccess(db: AccessDb, user: { id: string; role: UserRole }): Promise<AffiliateAccess> {
  if (user.role === 'AFFILIATE' || user.role === 'ADMIN') return { hasAccess: true, canOpenStorefront: true };
  if (user.role !== 'DEALER') return { hasAccess: false, canOpenStorefront: false };
  const [storefront, commission] = await Promise.all([
    db.storefront.findFirst({ where: { ownerUserId: user.id, type: 'CTV' }, select: { id: true } }),
    db.commission.findFirst({ where: { affiliateUserId: user.id }, select: { id: true } }),
  ]);
  return { hasAccess: storefront !== null || commission !== null, canOpenStorefront: storefront !== null };
}

export async function hasAffiliateAccess(db: AccessDb, user: { id: string; role: UserRole }): Promise<boolean> {
  return (await affiliateAccess(db, user)).hasAccess;
}
