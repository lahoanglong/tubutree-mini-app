import { useQuery } from '@tanstack/react-query';
import { getProductStock } from '@/lib/shop-client';

export { LOW_STOCK_NOTICE } from '@tubutree/app-core/commerce/stock-text';

/** Khoá tồn kho thật của một sản phẩm: nơi nào vừa bị máy chủ từ chối vì món hết hàng thì tải lại đúng khoá này. */
export const productStockKey = (slug: string) => ['product-stock', slug] as const;

/**
 * Tồn kho trong HTML là bản ISR (tối đa 5 phút tuổi); khi mở trang hỏi lại tồn kho thật. Lỗi/chưa xong thì dùng bản ISR.
 * Một khoá chung để khối mua và dòng "Còn N sản phẩm" ở khối thông tin dùng chung một lần gọi.
 */
export function useProductStock(slug: string) {
  return useQuery({
    queryKey: productStockKey(slug),
    queryFn: () => getProductStock(slug),
    staleTime: 30_000,
    retry: 0,
  });
}
