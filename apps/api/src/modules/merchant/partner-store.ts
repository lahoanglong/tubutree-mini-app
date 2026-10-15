import type { Prisma } from '@prisma/client';

/**
 * Gian hàng "đối tác" (tự đăng sản phẩm, tự giao, đối soát) được nhận diện theo chủ sở hữu, không chỉ theo loại gian hàng:
 * CTV đã mở gian hàng (Storefront.type = CTV, mỗi người một gian hàng) rồi được duyệt làm đại lý vẫn giữ loại CTV để
 * hoa hồng giới thiệu của gian hàng đó không đổi, nhưng vẫn dùng được Cổng người bán.
 */
export const PARTNER_STORE_WHERE: Prisma.StorefrontWhereInput = {
  OR: [{ type: 'MERCHANT' }, { type: 'CTV', owner: { role: 'DEALER' } }],
};

export function isPartnerStore(store: { type: string; owner?: { role: string } | null }): boolean {
  return store.type === 'MERCHANT' || (store.type === 'CTV' && store.owner?.role === 'DEALER');
}
