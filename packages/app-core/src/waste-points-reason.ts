/**
 * Nhãn sổ Điểm Xanh cho phí shipper thu gom tận nhà. Chuỗi `reason` do máy chủ ghi ở
 * `apps/api/.../waste-home-pickup-ledger.ts`: `WASTE_PICKUP_FEE:<mã phiếu>` (trừ) và `WASTE_PICKUP_FEE_REFUND:<mã phiếu>` (hoàn).
 * Mini App và web gọi hàm này trước bảng nhãn riêng của mỗi bên để hai nơi ra cùng một câu.
 */
const WASTE_POINTS_REASON_LABELS: Readonly<Record<string, string>> = {
  WASTE_PICKUP_FEE: 'Trừ phí shipper thu gom',
  WASTE_PICKUP_FEE_REFUND: 'Hoàn điểm phí shipper',
};

const REQUEST_CODE = /^[A-Za-z0-9_-]{1,40}$/;

/** null khi `reason` không phải dòng của phí shipper thu gom (bên gọi dùng bảng nhãn thường). Mã phiếu lạ thì chỉ in nhãn, không in chuỗi lạ. */
export function wastePickupFeeReasonLabel(rawReason: string): string | null {
  // Gộp phiên khách vãng lai đổi khoá một số dòng thành `MERGED:<id>:<reason cũ>`.
  const reason = rawReason.replace(/^MERGED:[^:]+:/, '');
  const sep = reason.indexOf(':');
  if (sep < 0) return null;
  const label = WASTE_POINTS_REASON_LABELS[reason.slice(0, sep)];
  if (!label) return null;
  const code = reason.slice(sep + 1);
  return REQUEST_CODE.test(code) ? `${label} · ${code}` : label;
}
