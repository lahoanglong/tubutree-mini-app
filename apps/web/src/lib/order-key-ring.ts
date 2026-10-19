/** Key cho place-order (AD-004); trình duyệt cũ thiếu crypto.randomUUID thì dùng chuỗi ngẫu nhiên đủ cho mục đích này. */
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
 * Idempotency-Key của "Đặt hàng" theo NỘI DUNG đơn, y như Mini App: bấm lại sau lỗi mạng/quá thời gian/5xx với cùng nội dung
 * gửi lại đúng key cũ (lần đầu có thể đã tạo đơn, server trả lại chính đơn đó); đổi địa chỉ, cách trả tiền, món, điểm... là
 * đơn khác nên key khác. Một key cố định cho cả phiên sẽ gửi hai nội dung khác nhau cùng một key. `reset()` khi đặt thành công.
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
    reset(): void {
      keys.clear();
    },
  };
}
