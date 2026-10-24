/**
 * Cam kết đổi trả ở trang sản phẩm. Số ngày đọc từ cấu hình công khai (returns.window_days).
 * - 0: API từ chối mọi yêu cầu đổi/trả, nên không hứa gì (null: ẩn dòng).
 * - Chưa biết (đang tải, API cũ, giá trị hỏng): nói chung, không điền số mặc định vì sẽ hứa sai khi chủ shop đã đổi.
 */
export function returnsPromise(returnWindowDays: unknown): string | null {
  if (returnWindowDays === 0) return null;
  const days = typeof returnWindowDays === 'number' && Number.isFinite(returnWindowDays) && returnWindowDays > 0 ? returnWindowDays : null;
  return days ? `Đổi trả trong ${days} ngày nếu lỗi` : 'Đổi trả nếu sản phẩm lỗi';
}
