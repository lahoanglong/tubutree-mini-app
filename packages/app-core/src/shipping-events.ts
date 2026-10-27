// Có dấu tiếng Việt → chuỗi đã được viết cho khách (vd Gomdon/BestExpress), không phải mã hãng.
const VIETNAMESE_CHARS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export const SHIPPING_STATUS_UNKNOWN = 'Đang cập nhật';
const UNKNOWN = SHIPPING_STATUS_UNKNOWN;

// Mã trạng thái hãng vận chuyển hay gặp (Pancake/GHN/GHTK/Best/Gomdon). Một bảng cho Mini App và web.
const LABELS: Record<string, string> = {
  pending: 'Chờ lấy hàng',
  created: 'Đã tạo vận đơn',
  new: 'Đã tạo vận đơn',
  ready_to_pick: 'Chờ lấy hàng',
  waiting_pickup: 'Chờ lấy hàng',
  picking: 'Đang lấy hàng',
  picking_up: 'Đang lấy hàng',
  picked: 'Đã lấy hàng',
  picked_up: 'Đã lấy hàng',
  storing: 'Hàng đang ở kho trung chuyển',
  sorting: 'Hàng đang ở kho trung chuyển',
  in_warehouse: 'Hàng đang ở kho trung chuyển',
  transporting: 'Đang vận chuyển',
  in_transit: 'Đang vận chuyển',
  shipping: 'Đang vận chuyển',
  delivering: 'Đang giao hàng',
  out_for_delivery: 'Đang giao hàng',
  delivered: 'Giao hàng thành công',
  delivery_success: 'Giao hàng thành công',
  completed: 'Giao hàng thành công',
  delivery_fail: 'Giao không thành công',
  delivery_failed: 'Giao không thành công',
  failed: 'Giao không thành công',
  waiting_to_return: 'Đang hoàn hàng',
  return: 'Đang hoàn hàng',
  returning: 'Đang hoàn hàng',
  return_transporting: 'Đang hoàn hàng',
  returned: 'Đã hoàn hàng',
  return_success: 'Đã hoàn hàng',
  cancel: 'Đã huỷ vận đơn',
  cancelled: 'Đã huỷ vận đơn',
  canceled: 'Đã huỷ vận đơn',
  lost: 'Thất lạc kiện hàng',
  damage: 'Kiện hàng bị hư hỏng',
  damaged: 'Kiện hàng bị hư hỏng',
  exception: 'Có sự cố vận chuyển',
};

/**
 * Nhãn tiếng Việt cho một mốc/trạng thái vận chuyển do hãng ghi vào đơn: rỗng → null; mã đã biết → nhãn;
 * chuỗi đã là tiếng Việt → giữ nguyên; mã lạ → "Đang cập nhật" (không in mã gốc ra cho khách).
 */
export function shippingEventLabel(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (VIETNAMESE_CHARS.test(text)) return text;
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return LABELS[key] ?? UNKNOWN;
}

/** Các mốc hành trình hiển thị được (có trạng thái hoặc mã vận đơn), mới nhất trước. Bỏ phần tử rác của dữ liệu cũ. */
export function journeyEvents<T extends { status?: string | null; code?: string | null }>(
  history: readonly (T | null | undefined)[] | null | undefined,
): T[] {
  if (!Array.isArray(history)) return [];
  return history.filter((e): e is T => !!e && typeof e === 'object' && !!(e.status || e.code)).reverse();
}

/**
 * Dòng chữ của một mốc hành trình: trạng thái hãng đã dịch; chưa có trạng thái mà có mã vận đơn thì "Đã gán mã vận đơn <mã>";
 * không có gì thì "Đang cập nhật" (không bao giờ "—").
 */
export function journeyEventLabel(ev: { status?: string | null; code?: string | null }): string {
  return shippingEventLabel(ev.status) ?? (ev.code ? `Đã gán mã vận đơn ${ev.code}` : UNKNOWN);
}
