import { pointsForGoods } from '../pricing/points-earn';

/**
 * Điểm của một claim đơn ngoài: `ratePct` là phần trăm (1 = 1%) như loyalty.earn_pct, làm tròn xuống, 1 điểm = 1đ.
 * Đơn sàn không nhân hệ số hạng nên `multiplier` mặc định 1. null = chưa tính được (thiếu tiền hàng): claim phải vào REVIEW
 * chứ không được coi là 0 điểm.
 */
export function claimPoints(goodsValue: number | null, ratePct: number, multiplier = 1): number | null {
  if (goodsValue === null || !(goodsValue > 0)) return null;
  return pointsForGoods(goodsValue, ratePct, multiplier);
}

/** Mã vận đơn hiện cho khách và admin: giữ 3 ký tự đầu và cuối (mã ngắn chỉ giữ ký tự đầu), phần giữa che bằng `*`. */
export function maskClaimCode(code: string | null | undefined): string {
  if (!code) return '';
  if (code.length <= 6) return `${code.slice(0, 1)}${'*'.repeat(code.length - 1)}`;
  return `${code.slice(0, 3)}${'*'.repeat(code.length - 6)}${code.slice(-3)}`;
}

/** Mã hiện trong thông báo: đơn chat thường chưa có mã đáng hiện, thay bằng cách gọi chung để câu không bị trống. */
export function claimCodeLabel(trackingCode: string | null | undefined, kind: 'SCAN' | 'PHONE'): string {
  return maskClaimCode(trackingCode) || (kind === 'PHONE' ? 'đặt qua tư vấn viên' : '');
}
