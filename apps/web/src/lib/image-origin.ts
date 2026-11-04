/**
 * Gốc (origin) phát ảnh đổi cỡ: `{api}/img?...` nên cùng gốc với API. Trang ở app.tubutree.com còn API ở api.tubutree.com, nên ảnh đầu trang
 * phải bắt tay TCP + TLS với gốc thứ hai sau khi trình duyệt đọc xong HTML; preconnect làm việc đó song song với tải CSS/JS.
 * Trả null khi chưa cấu hình hoặc không phải URL.
 */
export function apiImageOrigin(apiBase: string | undefined): string | null {
  if (!apiBase) return null;
  try {
    return new URL(apiBase).origin;
  } catch {
    return null;
  }
}
