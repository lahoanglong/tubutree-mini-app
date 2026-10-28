import type { WasteMethod, WastePreviewDTO } from '@tubutree/shared-types';

const BASE_ORDER: readonly WasteMethod[] = ['DROP_OFF', 'PICKUP', 'MAIL_IN'];
const MAIL_FIRST_ORDER: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP', 'DROP_OFF'];

/** Thẻ khoá khi có lý do chặn thật; NEED_PROVINCE chỉ là chưa chọn tỉnh nên không tính. */
export const isMethodLocked = (preview: WastePreviewDTO | undefined): boolean => preview?.blocks.some((b) => b.code !== 'NEED_PROVINCE') ?? false;

/** Các cách giao theo thứ tự mặc định (Mang tới điểm, Thu kèm đơn, Gửi về kho). */
export const WASTE_METHODS_BASE: readonly WasteMethod[] = BASE_ORDER;

/**
 * Thứ tự thẻ cách giao ở bước 2. Tỉnh chưa có điểm nhận thì Gửi về kho lên đầu. Thẻ đang khoá xếp cuối, nhưng chỉ khi mọi thẻ
 * đã có kết quả xem trước: thiếu một thẻ thì giữ nguyên thứ tự gốc để thẻ không nhảy chỗ lúc từng kết quả về.
 */
export function orderWasteMethods(
  enabled: readonly WasteMethod[],
  previews: Partial<Record<WasteMethod, WastePreviewDTO | undefined>>,
  noPointInProvince: boolean,
): WasteMethod[] {
  const base = (noPointInProvince ? MAIL_FIRST_ORDER : BASE_ORDER).filter((m) => enabled.includes(m));
  if (!base.every((m) => previews[m] !== undefined)) return base;
  return [...base].sort((a, b) => Number(isMethodLocked(previews[a])) - Number(isMethodLocked(previews[b])));
}
