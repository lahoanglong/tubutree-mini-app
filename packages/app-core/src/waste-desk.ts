import type { WasteDeskRequestDTO, WastePointKind, WasteShortfallReason } from '@tubutree/shared-types';

/** Chữ cho dòng món chỉ kho TP.HCM nhận khi quầy là điểm đối tác. */
export const WAREHOUSE_ONLY_RETURN_NOTE = 'Chỉ kho HCMC nhận, trả lại khách';

type DeskLineLike = { itemId: string; declaredQty: number; warehouseOnly?: boolean };

/** Món chỉ kho nhận mà quầy là điểm đối tác: điểm này không nhận được, máy chủ trả 409 nếu số nhận lớn hơn 0. */
export function isPartnerWarehouseOnly(line: Pick<DeskLineLike, 'warehouseOnly'>, pointKind: WastePointKind): boolean {
  return pointKind === 'PARTNER' && line.warehouseOnly === true;
}

/**
 * Số nhận mặc định của từng dòng khi mới tra mã: số khách khai, riêng món chỉ kho nhận ở điểm đối tác là 0 kèm lý do
 * "Không nhận" (nhận thiếu bắt buộc có lý do) để nhân viên không phải đoán dòng nào làm bấm duyệt bị 409.
 */
export function deskInitialLines(
  lines: readonly DeskLineLike[],
  pointKind: WastePointKind,
): { received: Record<string, number>; reasons: Record<string, WasteShortfallReason | ''> } {
  const received: Record<string, number> = {};
  const reasons: Record<string, WasteShortfallReason | ''> = {};
  for (const l of lines) {
    const locked = isPartnerWarehouseOnly(l, pointKind);
    received[l.itemId] = locked ? 0 : l.declaredQty;
    reasons[l.itemId] = locked ? 'NOT_ACCEPTED' : '';
  }
  return { received, reasons };
}

/** Tiêu đề thẻ và thông báo sau khi duyệt; 0 điểm thì không nói "cộng 0 điểm". */
export function deskDoneCopy(pointsAwarded: number, formatPoints: (n: number) => string): { heading: string; toast: string } {
  if (pointsAwarded === 0) {
    const text = 'Đã ghi nhận. Lần này chưa đủ để cộng điểm';
    return { heading: text, toast: text };
  }
  const willCredit = `Tubu sẽ cộng ${formatPoints(pointsAwarded)} cho khách`;
  return { heading: `Đã ghi nhận. ${willCredit}`, toast: willCredit };
}

const VN_OFFSET_MS = 7 * 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Dòng trạng thái của yêu cầu vừa đóng mà quầy xem lại (chỉ đọc). */
export function deskClosedText(r: Pick<WasteDeskRequestDTO, 'status' | 'closedAt'>): string {
  if (r.status !== 'COMPLETED') return 'Đã từ chối';
  if (!r.closedAt) return 'Đã duyệt';
  const vn = new Date(new Date(r.closedAt).getTime() + VN_OFFSET_MS);
  return `Đã duyệt lúc ${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())}`;
}
