import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const seq = vi.hoisted(() => ({ n: 0 }));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++seq.n}` }));
import { useIdempotencyKey } from './use-idempotency-key';

beforeEach(() => { seq.n = 0; });

describe('useIdempotencyKey (§16.1: giữ khi lỗi mạng, đổi khi đổi món/điểm/quà)', () => {
  it('cùng nội dung (object mới, cùng JSON) qua nhiều lần render → cùng key', () => {
    const { result, rerender } = renderHook(({ c }) => useIdempotencyKey(c), { initialProps: { c: { lines: [{ itemId: 'a', declaredQty: 2 }], pointId: 'p1' } } });
    const first = result.current.key;
    rerender({ c: { lines: [{ itemId: 'a', declaredQty: 2 }], pointId: 'p1' } });
    expect(result.current.key).toBe(first);
    expect(first).toBe('key-1');
  });
  it('thứ tự thuộc tính không làm đổi key', () => {
    const { result, rerender } = renderHook(({ c }) => useIdempotencyKey(c), { initialProps: { c: { a: 1, b: 2 } as Record<string, number> } });
    const first = result.current.key;
    rerender({ c: { b: 2, a: 1 } });
    expect(result.current.key).toBe(first);
  });
  it('đổi nội dung → key mới; quay lại nội dung cũ → dùng lại key cũ (lần gửi trước có thể đã thành công)', () => {
    const { result, rerender } = renderHook(({ c }) => useIdempotencyKey(c), { initialProps: { c: { q: 1 } } });
    const a = result.current.key;
    rerender({ c: { q: 2 } });
    const b = result.current.key;
    expect(b).not.toBe(a);
    rerender({ c: { q: 1 } });
    expect(result.current.key).toBe(a);
  });
  it('rotate() (gọi sau khi thành công) → cùng nội dung nhận key mới', () => {
    const { result } = renderHook(() => useIdempotencyKey({ q: 1 }));
    const a = result.current.key;
    act(() => result.current.rotate());
    expect(result.current.key).not.toBe(a);
    expect(result.current.key).toBe('key-2');
  });
});
