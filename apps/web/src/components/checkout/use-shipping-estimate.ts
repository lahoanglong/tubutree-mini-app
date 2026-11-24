'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { shippingEstimateAmount, shippingEstimateQuery, type ShippingEstimateOpts } from './shipping-estimate-query';

/**
 * Phí giao ước tính cho tiền hàng kiện Tubu `subtotal` (trước giảm giá, như thanh Miễn phí giao hàng). null hoặc 0 = không hỏi: giỏ có hàng
 * gian hàng tự giao (phí riêng từng gian hàng) hay chưa chọn món. `anonymous`: giỏ khách chưa đăng nhập. Lỗi thì không hiện dòng phí.
 * `pending`: đang hỏi lần đầu (chưa có số nào, kể cả số cũ), để nơi vẽ giữ chỗ dòng phí thay vì chèn nó vào sau.
 */
export function useShippingEstimate(subtotal: number | null, opts: ShippingEstimateOpts = {}) {
  const amount = shippingEstimateAmount(subtotal);
  const q = useQuery({
    ...shippingEstimateQuery(amount, opts),
    enabled: amount > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { estimate: amount > 0 ? q.data : undefined, stale: q.isPlaceholderData, pending: amount > 0 && q.isPending };
}
