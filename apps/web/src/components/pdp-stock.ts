import { useQuery } from '@tanstack/react-query';
import { getProductStock } from '@/lib/shop-client';

export { LOW_STOCK_NOTICE } from '@tubutree/app-core/commerce/stock-text';

/**
 * Tồn kho trong HTML là bản ISR (tối đa 5 phút tuổi); khi mở trang hỏi lại tồn kho thật. Lỗi/chưa xong thì dùng bản ISR.
 * Một khoá chung để khối mua và dòng "Còn N sản phẩm" ở khối thông tin dùng chung một lần gọi.
 */
export function useProductStock(slug: string) {
  return useQuery({
    queryKey: ['product-stock', slug],
    queryFn: () => getProductStock(slug),
    staleTime: 30_000,
    retry: 0,
  });
}
