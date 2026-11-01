import { useQuery } from '@tanstack/react-query';
import { getProductStock } from '@/lib/shop-client';

/** Còn từng này trở xuống thì nhắc "Chỉ còn N" để khách biết nên chốt sớm (cùng ngưỡng với Mini App). */
export const LOW_STOCK_NOTICE = 5;

/**
 * Tồn kho trong HTML là bản ISR (tối đa 5 phút tuổi); khi mở trang hỏi lại tồn kho thật. Lỗi/chưa xong thì dùng bản ISR.
 * Một khoá chung để khối mua và dòng "Chỉ còn N" ở khối thông tin dùng chung một lần gọi.
 */
export function useProductStock(slug: string) {
  return useQuery({
    queryKey: ['product-stock', slug],
    queryFn: () => getProductStock(slug),
    staleTime: 30_000,
    retry: 0,
  });
}
