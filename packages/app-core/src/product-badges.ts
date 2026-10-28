/** Sản phẩm tạo trong chừng này ngày gần nhất mới được dán nhãn "Mới". */
export const NEW_PRODUCT_DAYS = 30;

export const NEW_PRODUCT_LABEL = 'Mới';

const DAY_MS = 864e5;

/**
 * "Mới" = tạo trong 30 ngày gần nhất (tính cả ngày thứ 30). Thiếu hoặc sai ngày tạo (API cũ chưa trả) thì không nhãn, không đoán.
 * Ngày tạo hơi lệch về tương lai (đồng hồ máy khách chậm hơn máy chủ) vẫn tính là mới.
 */
export function isNewProduct(createdAt: string | null | undefined, now: number | Date = Date.now()): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return nowMs - created <= NEW_PRODUCT_DAYS * DAY_MS;
}
