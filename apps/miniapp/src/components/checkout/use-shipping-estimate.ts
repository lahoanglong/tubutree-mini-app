import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getShippingEstimate, SHIPPING_ESTIMATE_STALE_MS } from '@tubutree/app-core/api/shipping-estimate';
import { coreHttp } from '../../services/core-http';

/**
 * Phí giao ước tính cho tiền hàng kiện Tubu `subtotal` (trước giảm giá, như thanh Miễn phí giao hàng). null hoặc 0 = không hỏi: giỏ có hàng
 * gian hàng tự giao (phí riêng từng gian hàng) hay chưa chọn món. Lỗi thì không hiện dòng phí, không chặn giỏ.
 */
export function useShippingEstimate(subtotal: number | null, provinceCode?: string | null) {
  const amount = subtotal != null && subtotal > 0 ? Math.round(subtotal) : 0;
  const q = useQuery({
    queryKey: ['shipping-estimate', amount, provinceCode ?? null],
    queryFn: () => getShippingEstimate(coreHttp, { subtotal: amount, provinceCode }),
    enabled: amount > 0,
    staleTime: SHIPPING_ESTIMATE_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { estimate: amount > 0 ? q.data : undefined, stale: q.isPlaceholderData };
}
