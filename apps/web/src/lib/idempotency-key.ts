/** Idempotency-Key cho lệnh ghi tiền; cùng cách sinh với Mini App (randomUUID, trình duyệt quá cũ thì ngẫu nhiên đủ dùng). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `idk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
