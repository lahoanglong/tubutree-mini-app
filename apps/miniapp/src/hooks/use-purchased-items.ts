import { useQuery } from '@tanstack/react-query';
import { fetchPurchasedItems } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

export const PURCHASED_ITEMS_KEY = 'purchased-items';

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
