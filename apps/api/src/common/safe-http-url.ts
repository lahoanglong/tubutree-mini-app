/** Link do bên thứ ba gửi (tra cứu vận đơn): chỉ nhận http(s) không kèm user:pass; còn lại null. Trả dạng chuẩn hoá của URL. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null;
  try {
    const u = new URL(value.trim());
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
