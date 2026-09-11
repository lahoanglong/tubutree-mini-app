/**
 * Sinh idempotency key cho place-order (AD-004).
 * WebView cũ có thể thiếu crypto.randomUUID → fallback đủ ngẫu nhiên cho mục đích này.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * ID ngẫu nhiên mạnh cho định danh thiết bị (đăng nhập khách).
 *
 * `deviceId` là thứ DUY NHẤT xác thực tài khoản khách ở `/auth/guest` — đoán được nó là đăng
 * nhập được vào giỏ hàng/đơn/điểm/xu của khách khác. `Date.now()+Math.random()` chỉ cho vài
 * chục bit entropy và Math.random KHÔNG phải nguồn mật mã (đoán trước được state), nên ở đây
 * bắt buộc dùng crypto. Thứ tự ưu tiên: randomUUID → getRandomValues → (WebView quá cũ) mới
 * đành quay lại Math.random, nhưng trộn thêm nhiều nguồn để không tệ hơn bản cũ.
 */
export function newDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `d_${crypto.randomUUID()}`;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `d_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  const rand = () => Math.random().toString(36).slice(2, 12);
  return `d_${Date.now().toString(36)}_${rand()}${rand()}`;
}
