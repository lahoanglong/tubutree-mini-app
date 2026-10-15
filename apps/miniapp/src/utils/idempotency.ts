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

/** Trường đi theo báo giá chứ không theo yêu cầu của khách: đổi chúng không biến lần bấm lại thành đơn khác. */
const QUOTE_ONLY_FIELDS = new Set(['expectedTotal', 'quotedZeroTotal']);

function fingerprintOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(fingerprintOf).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([k, x]) => x !== undefined && !QUOTE_ONLY_FIELDS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${fingerprintOf(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Idempotency-Key cho "Đặt hàng" trong một lần mở màn thanh toán (như web: một đơn một key). Bấm lại sau lỗi mạng, quá
 * thời gian hay 5xx với cùng nội dung đơn thì gửi lại đúng key cũ: lần đầu có thể đã tạo đơn, server trả lại chính đơn đó
 * thay vì đặt thêm. Khách đổi nội dung (địa chỉ, cách trả tiền, món, điểm...) là đơn khác, key khác. `reset()` khi đặt
 * thành công.
 */
export function createOrderKeyRing(make: () => string = newIdempotencyKey) {
  const keys = new Map<string, string>();
  return {
    keyFor(body: object): string {
      const fingerprint = fingerprintOf(body);
      let key = keys.get(fingerprint);
      if (!key) {
        key = make();
        keys.set(fingerprint, key);
      }
      return key;
    },
    /** Key đã cấp cho nội dung này (undefined = chưa gửi lần nào), không cấp key mới. */
    peek(body: object): string | undefined {
      return keys.get(fingerprintOf(body));
    },
    reset(): void {
      keys.clear();
    },
  };
}

/**
 * ID ngẫu nhiên mạnh cho định danh thiết bị (đăng nhập khách).
 *
 * `deviceId` là thứ DUY NHẤT xác thực tài khoản khách ở `/auth/guest` — đoán được nó là đăng
 * nhập được vào giỏ hàng/đơn/điểm của khách khác. `Date.now()+Math.random()` chỉ cho vài
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
