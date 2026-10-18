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
 * Idempotency-Key cho lệnh tạo đơn trong một lần mở form: bấm lại sau lỗi mạng, quá thời gian hay 5xx với cùng nội dung gửi
 * lại đúng key cũ (lần đầu có thể đã tạo đơn, máy chủ trả lại chính đơn đó thay vì tạo thêm); đổi nội dung là đơn khác, key
 * khác. `reset()` khi tạo đơn thành công. Cùng quy tắc với `createOrderKeyRing` của Mini App.
 */
export function createOrderKeyRing(make: () => string) {
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
