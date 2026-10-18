import type { HttpClient } from '../http';
import { getCart, getCartSelection } from '../api/cart';

/** Khoá giỏ kèm gian hàng CTV: combo đổi theo gian hàng; `invalidateQueries({ queryKey: ['cart'] })` vẫn khớp mọi gian hàng (tiền tố). */
export const cartQuery = (http: HttpClient, storefrontSlug: string | null) => ({
  queryKey: ['cart', storefrontSlug] as const,
  queryFn: () => getCart(http, storefrontSlug),
});
/** `sig` là chữ ký đã debounce của phần giỏ đang chọn (trang giỏ tự dựng). */
export const cartSelectionQuery = (http: HttpClient, storefrontSlug: string | null, sig: string, itemIds: string[]) => ({
  queryKey: ['cart', storefrontSlug, 'selection', sig] as const,
  queryFn: () => getCartSelection(http, itemIds, storefrontSlug),
});
