import type { HttpClient } from '../http';
import { vnd } from '../commerce/money';
import { fillCopy } from '../shop-copy';

/** Phản hồi `GET /checkout/shipping-estimate`: phí giao kiện Tubu ước tính trước khi có địa chỉ. */
export interface ShippingEstimate {
  fee: number;
  feeMin: number;
  feeMax: number;
  freeshipThreshold: number;
  missingForFreeship: number;
  isEstimate: true;
  provinceCode: string | null;
  provinceName: string | null;
}

export const SHIPPING_ESTIMATE_PATH = '/checkout/shipping-estimate';
/** Máy chủ cho trình duyệt giữ 5 phút; màn cũng giữ chừng đó để đổi số lượng qua lại không gọi lại. */
export const SHIPPING_ESTIMATE_STALE_MS = 5 * 60_000;

/**
 * `subtotal` là tiền hàng kiện Tubu đang chọn, trước mọi khoản giảm (như thanh Miễn phí giao hàng). `anonymous`: giỏ chưa đăng nhập của web,
 * không gửi phiên.
 */
export function getShippingEstimate(
  http: HttpClient,
  params: { subtotal: number; provinceCode?: string | null },
  opts: { anonymous?: boolean } = {},
): Promise<ShippingEstimate> {
  const subtotal = Math.max(0, Math.round(params.subtotal));
  return http.get<ShippingEstimate>(SHIPPING_ESTIMATE_PATH, {
    query: params.provinceCode ? { subtotal, provinceCode: params.provinceCode } : { subtotal },
    ...(opts.anonymous ? { anonymous: true } : {}),
  });
}

export interface CartShippingView {
  feeLabel: string;
  feeText: string;
  free: boolean;
  /** null khi phí còn là một khoảng: không cộng ra một tổng duy nhất. */
  totalLabel: string | null;
  total: number | null;
}

/**
 * Dòng "Phí giao (ước tính)" và "Tổng tạm tính" dưới Tạm tính của giỏ. `freeshipReached` là trạng thái của thanh Miễn phí giao hàng đang
 * hiện (ngưỡng hoặc mã miễn phí giao của giỏ), để dòng phí không nói khác thanh. Chưa có ước tính thì null: giỏ giữ cách hiện cũ.
 * `stale`: số của tiền hàng trước (đang hỏi lại sau khi đổi số lượng). Phí dưới ngưỡng là phí phẳng nên số cũ vẫn đúng, trừ khi số cũ là
 * "miễn phí" mà thanh đã hết miễn phí: lúc đó chưa biết phí, không hiện dòng.
 */
export function cartShippingView(
  est: ShippingEstimate | null | undefined,
  opts: { goodsNet: number; freeshipReached: boolean; stale?: boolean },
): CartShippingView | null {
  // Phản hồi thiếu số (máy chủ cũ, proxy trả trang lỗi 200) thì coi như chưa có ước tính, không cộng ra "NaNđ".
  if (!est || ![est.fee, est.feeMin, est.feeMax].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (opts.stale && !opts.freeshipReached && est.feeMax === 0) return null;
  const free = opts.freeshipReached || est.feeMax === 0;
  const range = !free && est.feeMin !== est.feeMax;
  const fee = free ? 0 : est.fee;
  return {
    feeLabel: fillCopy('cart.shipEstimate'),
    feeText: free
      ? fillCopy('cart.shipEstimateFree')
      : range
        ? fillCopy('cart.shipEstimateRange', { min: vnd(est.feeMin), max: vnd(est.feeMax) })
        : vnd(fee),
    free,
    totalLabel: range ? null : fillCopy('cart.totalEstimate'),
    total: range ? null : Math.max(0, opts.goodsNet) + fee,
  };
}
