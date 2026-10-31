/** Sản phẩm tạo trong chừng này ngày gần nhất mới được dán nhãn "Mới". */
export const NEW_PRODUCT_DAYS = 30;

export const NEW_PRODUCT_LABEL = 'Mới';

const DAY_MS = 864e5;

const LAUNCH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 00:00 giờ Việt Nam của ngày mở bán (YYYY-MM-DD) tính bằng mili-giây; rỗng, thiếu hay sai dạng thì null (không có mốc). */
export function launchDateStart(launchDate: string | null | undefined): number | null {
  if (typeof launchDate !== 'string' || !LAUNCH_DATE_RE.test(launchDate)) return null;
  const [y, m, d] = launchDate.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  // Ngày không có thật (30/02) bị Date tự cuộn sang tháng sau: so lại từng phần để loại.
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return utc.getTime() - 7 * 3_600_000;
}

/**
 * "Mới" = tạo trong 30 ngày gần nhất (tính cả ngày thứ 30). Thiếu hoặc sai ngày tạo (API cũ chưa trả) thì không nhãn, không đoán.
 * Ngày tạo hơi lệch về tương lai (đồng hồ máy khách chậm hơn máy chủ) vẫn tính là mới.
 * `launchDate` (catalog.launch_date, giờ Việt Nam): sản phẩm tạo trước 00:00 ngày đó là hàng của đợt nạp dữ liệu ban đầu, không gắn "Mới".
 */
export function isNewProduct(createdAt: string | null | undefined, now: number | Date = Date.now(), launchDate?: string | null): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  const start = launchDateStart(launchDate);
  if (start !== null && created < start) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return nowMs - created <= NEW_PRODUCT_DAYS * DAY_MS;
}
