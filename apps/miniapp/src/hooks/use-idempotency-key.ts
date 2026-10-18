import { useCallback, useRef, useState } from 'react';
import { newIdempotencyKey } from '../utils/idempotency';

function fingerprintOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(fingerprintOf).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${fingerprintOf(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Một key cho mỗi nội dung gửi: gửi lại sau lỗi mạng dùng đúng key cũ (lần trước có thể đã thành công), đổi nội dung
 * thì key mới, quay lại nội dung cũ thì key cũ. Chỉ gọi rotate() sau khi thành công.
 */
export function useIdempotencyKey(content: unknown): { key: string; rotate(): void } {
  const keys = useRef<Map<string, string>>(new Map());
  const [, setTick] = useState(0);
  const fingerprint = fingerprintOf(content);
  let key = keys.current.get(fingerprint);
  if (!key) {
    key = newIdempotencyKey();
    keys.current.set(fingerprint, key);
  }
  const rotate = useCallback(() => {
    keys.current.delete(fingerprint);
    setTick((n) => n + 1);
  }, [fingerprint]);
  return { key, rotate };
}
