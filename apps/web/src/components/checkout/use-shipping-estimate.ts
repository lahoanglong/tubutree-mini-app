'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getShippingEstimate, SHIPPING_ESTIMATE_STALE_MS } from '@tubutree/app-core/api/shipping-estimate';
import { coreHttp } from '@/lib/core-http';

/**
 * Phí giao ước tính cho tiền hàng kiện Tubu `subtotal` (trước giảm giá, như thanh Miễn phí giao hàng). null hoặc 0 = không hỏi: giỏ có hàng
 * gian hàng tự giao (phí riêng từng gian hàng) hay chưa chọn món. `anonymous`: giỏ khách chưa đăng nhập. Lỗi thì không hiện dòng phí.
 */
export function useShippingEstimate(subtotal: number | null, opts: { provinceCode?: string | null; anonymous?: boolean } = {}) {
  const amount = subtotal != null && subtotal > 0 ? Math.round(subtotal) : 0;
  const q = useQuery({
    queryKey: ['shipping-estimate', amount, opts.provinceCode ?? null, opts.anonymous ? 'anon' : 'me'],
    queryFn: () => getShippingEstimate(coreHttp, { subtotal: amount, provinceCode: opts.provinceCode }, { anonymous: opts.anonymous }),
    enabled: amount > 0,
    staleTime: SHIPPING_ESTIMATE_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { estimate: amount > 0 ? q.data : undefined, stale: q.isPlaceholderData };
}
