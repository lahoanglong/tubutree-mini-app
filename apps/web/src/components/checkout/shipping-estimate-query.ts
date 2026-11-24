import { getShippingEstimate, SHIPPING_ESTIMATE_STALE_MS } from '@tubutree/app-core/api/shipping-estimate';
import { coreHttp } from '@/lib/core-http';

export interface ShippingEstimateOpts {
  provinceCode?: string | null;
  /** Giỏ khách chưa đăng nhập. */
  anonymous?: boolean;
}

/** Tiền hàng làm tròn để hỏi phí giao; 0 = không hỏi (null, 0 hoặc âm). */
export const shippingEstimateAmount = (subtotal: number | null): number => (subtotal != null && subtotal > 0 ? Math.round(subtotal) : 0);

/** Khoá, hàm gọi và staleTime của phí giao ước tính: một chỗ cho `useShippingEstimate` và phần làm nóng Thanh toán từ giỏ, để hai bên luôn trùng khoá. */
export function shippingEstimateQuery(amount: number, opts: ShippingEstimateOpts = {}) {
  return {
    queryKey: ['shipping-estimate', amount, opts.provinceCode ?? null, opts.anonymous ? 'anon' : 'me'] as const,
    queryFn: () => getShippingEstimate(coreHttp, { subtotal: amount, provinceCode: opts.provinceCode }, { anonymous: opts.anonymous }),
    staleTime: SHIPPING_ESTIMATE_STALE_MS,
  };
}
