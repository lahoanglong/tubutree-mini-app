export interface PartnerStoreLike {
  type?: string | null;
  isPartner?: boolean | null;
}

/** Gian hàng có quyền đối tác (đăng sản phẩm, tự giao, đối soát):khớp API: type MERCHANT hoặc isPartner=true (MERCHANT tạo lúc triển khai cuốn chiếu có thể mang isPartner=false mặc định của cột). */
export function isPartnerStore(store: PartnerStoreLike | null | undefined): boolean {
  if (!store) return false;
  return store.type === 'MERCHANT' || store.isPartner === true;
}
