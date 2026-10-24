/**
 * Cam kết đổi trả ở trang sản phẩm. Số ngày đọc từ cấu hình công khai (returns.window_days); chưa biết (đang tải, API cũ,
 * giá trị hỏng) thì nói chung, không điền số mặc định vì sẽ hứa sai khi chủ shop đã đổi.
 */
export function returnsPromise(returnWindowDays: unknown): string {
  const days = typeof returnWindowDays === 'number' && Number.isFinite(returnWindowDays) && returnWindowDays > 0 ? returnWindowDays : null;
  return days ? `Đổi trả trong ${days} ngày nếu lỗi` : 'Đổi trả nếu sản phẩm lỗi';
}
