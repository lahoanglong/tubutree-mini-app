export interface ShippingEta {
  minDays: number;
  maxDays: number;
}

/** Khoảng ngày giao dự kiến (spec §2: cố định từ SystemConfig, chưa theo tỉnh). Cấu hình thiếu
 * hoặc sai → null để FE ẩn hẳn dòng này thay vì hứa một con số chủ shop chưa đặt. */
export function toShippingEta(min: unknown, max: unknown): ShippingEta | null {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  const lo = min as number;
  const hi = max as number;
  if (lo < 0 || hi < lo || hi > 60) return null;
  return { minDays: lo, maxDays: hi };
}
