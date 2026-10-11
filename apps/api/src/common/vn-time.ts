/**
 * Mốc thời gian theo lịch giờ Việt Nam (UTC+7, không có DST), tính thuần bằng số học UTC nên KHÔNG
 * phụ thuộc biến TZ của host/container. Dùng thay cho `setHours(0,0,0,0)` / `getMonth()` / `getDate()`
 * trên Date local — những hàm đó cho ra mốc lệch 7 tiếng khi process chạy UTC.
 */
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Thành phần lịch (năm, tháng 1-12, ngày) của thời điểm `d` theo giờ VN. */
export function vnDateParts(d: Date = new Date()): { year: number; month: number; day: number } {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return { year: vn.getUTCFullYear(), month: vn.getUTCMonth() + 1, day: vn.getUTCDate() };
}

/** 00:00 giờ VN của ngày chứa `d` (trả về thời điểm UTC tương ứng). */
export function startOfVnDay(d: Date = new Date()): Date {
  const { year, month, day } = vnDateParts(d);
  return new Date(Date.UTC(year, month - 1, day) - VN_OFFSET_MS);
}

/** 00:00 giờ VN ngày 1 của tháng chứa `d`. */
export function startOfVnMonth(d: Date = new Date()): Date {
  const { year, month } = vnDateParts(d);
  return new Date(Date.UTC(year, month - 1, 1) - VN_OFFSET_MS);
}

/** 'YYYY-MM-DD' theo giờ VN. */
export function vnDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM' theo giờ VN. */
export function vnMonthKey(d: Date = new Date()): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 7);
}

/** Ngày hiển thị cho khách ('10/10/2026') theo giờ VN; `toLocaleDateString('vi-VN')` trần dùng TZ host. */
export function formatVnDate(d: Date): string {
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
