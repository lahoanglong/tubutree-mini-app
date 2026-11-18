import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Trần giảm gộp của một đơn (luật A6): giảm theo voucher/mã + giảm bằng Điểm Xanh (lô thường) cộng lại không vượt
 * `loyalty.max_redeem_pct` × tạm tính (tổng tiền các dòng được đặt, trước mọi giảm giá). Một mã một mình cũng không vượt trần này.
 * Mã giảm trước, Điểm Xanh lấy phần trần còn lại. Ngoài trần: combo/Hộp Xanh (gian hàng tài trợ), giảm theo hạng (quyền lợi tự động),
 * mã miễn phí giao (phí giao, không phải tiền hàng) và lô Điểm Xanh quy đổi từ xu cũ (PD-3 spec 2.3: không trần).
 * Giỏ, xem trước mã, báo giá và đặt đơn cùng dùng các hàm này nên số khách thấy là số bị trừ.
 */
export const MAX_REDEEM_PCT_KEY = 'loyalty.max_redeem_pct';
export const MAX_REDEEM_PCT_DEFAULT = 0.2;

/** Phân số trong [0, 1]; sai dạng thì về mặc định 20% (không mở trần vì gõ nhầm). */
export function parseRedeemPct(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : MAX_REDEEM_PCT_DEFAULT;
}

export async function loadRedeemPct(config: Pick<SystemConfigService, 'get'>): Promise<number> {
  return parseRedeemPct(await config.get<unknown>(MAX_REDEEM_PCT_KEY, MAX_REDEEM_PCT_DEFAULT));
}

/** Số đồng tối đa voucher + Điểm Xanh được giảm cho đơn có tạm tính `subtotal`; làm tròn xuống. */
export function combinedRedeemCap(subtotal: number, pct: number): number {
  if (!(subtotal > 0) || !(pct > 0)) return 0;
  return Math.floor(subtotal * pct);
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const pctText = (pct: number) => `${Math.round(pct * 100)}%`;

/** Mã bị kẹp ở trần gộp nhưng vẫn giảm được một phần. */
export function couponCapNote(discount: number, pct: number): string {
  return `Voucher và Điểm Xanh giảm tối đa ${pctText(pct)} tạm tính mỗi đơn, nên mã giảm ${vnd(discount)} cho đơn này.`;
}

/** Trần gộp đang là 0 (admin đặt `loyalty.max_redeem_pct` = 0): mã giữ trong giỏ nhưng không giảm được, không tiêu lượt. */
export const COUPON_CAP_ZERO_REASON = 'Mức giảm tối đa từ voucher và Điểm Xanh đang là 0% nên mã chưa giảm được cho đơn này.';

/** Số Điểm Xanh dùng được ít đi vì voucher đã dùng một phần trần gộp. `pointsMax` là trần điểm của đơn sau khi kẹp. */
export function pointsCapNote(pointsMax: number, pct: number): string {
  if (pointsMax <= 0) return `Voucher đã dùng hết mức giảm ${pctText(pct)} tạm tính của đơn này, nên chưa dùng thêm được Điểm Xanh.`;
  return `Đơn này dùng tối đa ${pointsMax.toLocaleString('vi-VN')} Điểm Xanh: voucher và Điểm Xanh giảm tối đa ${pctText(pct)} tạm tính mỗi đơn.`;
}
