import type { Prisma } from '@prisma/client';

/**
 * Gian hàng "đối tác" (tự đăng sản phẩm, tự giao, đối soát) nhận diện bằng cờ bền Storefront.isPartner, không suy từ vai trò
 * hiện tại của chủ: CTV đã mở gian hàng (Storefront.type = CTV, mỗi người một gian hàng) rồi được duyệt đại lý vẫn giữ loại CTV
 * để hoa hồng giới thiệu không đổi. Khi chủ rơi xuống CUSTOMER/AFFILIATE cờ chỉ tắt (gian hàng MERCHANT về loại CTV) lúc không còn
 * việc dở (đơn, đối soát, trả hàng không được mồ côi); còn vướng thì việc đổi vai trò bị từ chối (xem losesPartnerStore).
 */
export const PARTNER_STORE_WHERE: Prisma.StorefrontWhereInput = {
  OR: [{ type: 'MERCHANT' }, { isPartner: true }],
};

/**
 * Khoá tư vấn theo chủ gian hàng: thu hồi vai trò (kể cả khi chủ chưa có dòng gian hàng nào để khoá) và lần tạo gian hàng đầu tiên ở
 * Cổng người bán cùng giữ khoá này, để gian hàng vừa tạo luôn khớp vai trò chủ. Thứ tự: danh sách admin → khoá này → khoá phiếu →
 * dòng gian hàng → users. Đặt đơn không đụng khoá này.
 */
export async function lockStoreOwner(tx: Prisma.TransactionClient, ownerUserId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-owner:${ownerUserId}`}))`;
}

/**
 * Đổi vai trò làm gian hàng đối tác của chủ mất tư cách: chủ rơi xuống CUSTOMER/AFFILIATE từ DEALER/STAFF/ADMIN. DEALER lên
 * STAFF/ADMIN thì KHÔNG (thăng tạm thời, rbac chỉ trả về DEALER những đại lý có đơn đại lý đã duyệt khi bỏ quyền nhân viên).
 */
export function losesPartnerStore(from: string, to: string): boolean {
  return (to === 'CUSTOMER' || to === 'AFFILIATE') && (from === 'DEALER' || from === 'STAFF' || from === 'ADMIN');
}

export function isPartnerStore(store: { type: string; isPartner?: boolean | null }): boolean {
  return store.type === 'MERCHANT' || store.isPartner === true;
}

/** Gian hàng đã có phiếu đối soát nào chưa: cổng chung cho tab "Hàng trả về" (hasPayouts) và `listForMerchant` của chủ đã tắt cờ. */
export async function storeHasPayouts(db: { merchantPayout: { count(args: { where: { storefrontId: string } }): Promise<number> } }, storefrontId: string): Promise<boolean> {
  return (await db.merchantPayout.count({ where: { storefrontId } })) > 0;
}

/**
 * Dấu ở `reason` của dòng STOREFRONT_PARTNER false → true do admin bật tay (setStorePartner): `<id gian hàng>:ADMIN_TOGGLE`. Cờ bật từ
 * Cổng người bán hoặc duyệt đại lý ghi `<id gian hàng>` trơn. Cờ CTV có lần bật MỚI NHẤT mang dấu này là cờ admin, không bị đổi
 * CUSTOMER ↔ AFFILIATE đụng tới; cờ theo vai trò thì tắt khi chủ được đặt về CUSTOMER/AFFILIATE.
 */
export const ADMIN_TOGGLE_MARK = ':ADMIN_TOGGLE';
