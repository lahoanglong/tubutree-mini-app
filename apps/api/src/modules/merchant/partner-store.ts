import type { Prisma } from '@prisma/client';

/**
 * Gian hàng "đối tác" (tự đăng sản phẩm, tự giao, đối soát) nhận diện bằng cờ bền Storefront.isPartner, không suy từ vai trò
 * hiện tại của chủ: CTV đã mở gian hàng (Storefront.type = CTV, mỗi người một gian hàng) rồi được duyệt đại lý vẫn giữ loại CTV
 * để hoa hồng giới thiệu không đổi, và vẫn là đối tác dù sau đó bị đổi vai trò (đơn, đối soát, trả hàng đang dở không được mồ côi).
 */
export const PARTNER_STORE_WHERE: Prisma.StorefrontWhereInput = {
  OR: [{ type: 'MERCHANT' }, { isPartner: true }],
};

/**
 * Đổi vai trò làm gian hàng đối tác của chủ mất tư cách: chủ rơi xuống CUSTOMER/AFFILIATE từ DEALER/STAFF/ADMIN. DEALER lên
 * STAFF/ADMIN thì KHÔNG (thăng tạm thời, rbac trả họ về DEALER khi bỏ quyền nhân viên).
 */
export function losesPartnerStore(from: string, to: string): boolean {
  return (to === 'CUSTOMER' || to === 'AFFILIATE') && (from === 'DEALER' || from === 'STAFF' || from === 'ADMIN');
}

export function isPartnerStore(store: { type: string; isPartner?: boolean | null }): boolean {
  return store.type === 'MERCHANT' || store.isPartner === true;
}
