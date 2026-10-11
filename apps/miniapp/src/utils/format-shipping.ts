import { vi } from '../i18n/vi';

export const SHIPPING_STATUS_UNKNOWN = vi.shippingEvent.unknown;

/** Có dấu tiếng Việt → chuỗi đã được viết cho khách (vd Gomdon/BestExpress), không phải mã hãng. */
const VIETNAMESE_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * Nhãn tiếng Việt cho một mốc/trạng thái vận chuyển do hãng ghi vào đơn.
 *  - rỗng → null (nơi gọi tự hiện "—");
 *  - mã hãng đã biết ("delivering", "ready_to_pick"...) → nhãn tiếng Việt;
 *  - chuỗi đã là tiếng Việt → giữ nguyên;
 *  - mã lạ → "Đang cập nhật" (không in mã gốc ra cho khách).
 */
export function shippingEventLabel(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (VIETNAMESE_CHARS.test(text)) return text;
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return vi.shippingEvent.labels[key] ?? vi.shippingEvent.unknown;
}
