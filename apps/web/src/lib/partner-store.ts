export interface PartnerStoreLike {
  type?: string | null;
  isPartner?: boolean | null;
}

/** Gian hàng có quyền đối tác (đăng sản phẩm, tự giao, đối soát):`isPartner` do API quyết định; phản hồi cũ chưa có trường này thì xét theo type như trước. */
export function isPartnerStore(store: PartnerStoreLike | null | undefined): boolean {
  if (!store) return false;
  return store.isPartner ?? store.type === 'MERCHANT';
}
