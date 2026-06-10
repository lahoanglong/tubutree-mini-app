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
