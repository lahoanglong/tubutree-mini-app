let offsetMs = 0;

/**
 * Độ lệch giữa đồng hồ máy chủ và đồng hồ điện thoại. Điện thoại khách hay lệch vài phút (tắt giờ tự động, múi giờ sai), nên
 * mọi đếm ngược tới một mốc do máy chủ đặt (giờ vàng, hạn chuyển khoản) phải tính theo giờ máy chủ; máy chủ vẫn là bên quyết
 * định hết giờ lúc thanh toán. Chỉ cập nhật khi API trả mốc hợp lệ, API cũ không trả thì giữ độ lệch đang có.
 */
export function syncServerClock(serverIso: unknown): void {
  if (typeof serverIso !== 'string') return;
  const serverMs = Date.parse(serverIso);
  if (Number.isNaN(serverMs)) return;
  offsetMs = serverMs - Date.now();
}

/** Giờ máy chủ (ms epoch) theo độ lệch đã đo gần nhất; chưa đo thì bằng đồng hồ điện thoại. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
