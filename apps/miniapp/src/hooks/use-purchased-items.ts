import { useQuery } from '@tanstack/react-query';
import { fetchPurchasedItems } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

export const PURCHASED_ITEMS_KEY = 'purchased-items';
/** Trang đầu mà kệ Mua lại, Trang chủ (chọn bố cục khách cũ/mới, chống trùng) và tab Đơn hàng dùng CHUNG khoá ['purchased-items', 10]. Ở đây, không ở kệ, để Trang chủ không kéo mã kệ (nằm trong chunk `home-below`) vào gói đầu. */
export const PURCHASED_RAIL_LIMIT = 10;

/** Trang đầu SP đã mua (kệ "Mua lại"). retry:false — API cũ trả 404 thì ẩn kệ ngay (Ruling 19). */
export function usePurchasedItems(limit: number) {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: [PURCHASED_ITEMS_KEY, limit],
    queryFn: () => fetchPurchasedItems({ limit }),
    enabled: authed,
    staleTime: 60_000,
    retry: false,
  });
}
