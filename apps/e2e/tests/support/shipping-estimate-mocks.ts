/** Ngưỡng và phí phẳng mặc định của cấu hình (`shipping.free_threshold`, `shipping.flat_fee_below_threshold`). */
export const ESTIMATE_THRESHOLD = 200_000;
export const ESTIMATE_FLAT_FEE = 19_000;

/** Phản hồi `GET /checkout/shipping-estimate` như máy chủ với cấu hình mặc định, khách không có hạng hay ưu đãi đơn đầu. */
export function shippingEstimate(subtotal: number) {
  const fee = subtotal >= ESTIMATE_THRESHOLD ? 0 : ESTIMATE_FLAT_FEE;
  return {
    fee,
    feeMin: fee,
    feeMax: fee,
    freeshipThreshold: ESTIMATE_THRESHOLD,
    missingForFreeship: fee === 0 ? 0 : ESTIMATE_THRESHOLD - subtotal,
    isEstimate: true as const,
    provinceCode: null,
    provinceName: null,
  };
}
