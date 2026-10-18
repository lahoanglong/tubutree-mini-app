// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { render, type Rendered } from '@/test-utils/dom';

const seq = vi.hoisted(() => ({ n: 0 }));
vi.mock('./idempotency-key', () => ({ newIdempotencyKey: () => `key-${++seq.n}` }));

import { useIdempotencyKey } from './use-idempotency-key';

let mounted: Rendered[] = [];
let current: { key: string; rotate(): void };
let setContent: (c: unknown) => void;
function Probe({ initial }: { initial: unknown }) {
  const [content, set] = useState(initial);
  setContent = set;
  current = useIdempotencyKey(content);
  return null;
}
const mount = (content: unknown) => mounted.push(render(<Probe initial={content} />));
const change = (content: unknown) => act(() => setContent(content));

beforeEach(() => {
  seq.n = 0;
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('useIdempotencyKey (giữ khi lỗi mạng, đổi khi đổi nội dung)', () => {
  it('cùng nội dung qua nhiều lần render → cùng key', () => {
    mount({ lines: [{ itemId: 'a', declaredQty: 2 }], pointId: 'p1' });
    const first = current.key;
    change({ lines: [{ itemId: 'a', declaredQty: 2 }], pointId: 'p1' });
    expect(current.key).toBe(first);
    expect(first).toBe('key-1');
  });
  it('thứ tự thuộc tính không làm đổi key', () => {
    mount({ a: 1, b: 2 });
    const first = current.key;
    change({ b: 2, a: 1 });
    expect(current.key).toBe(first);
  });
  it('đổi nội dung → key mới; quay lại nội dung cũ → dùng lại key cũ', () => {
    mount({ q: 1 });
    const a = current.key;
    change({ q: 2 });
    expect(current.key).not.toBe(a);
    change({ q: 1 });
    expect(current.key).toBe(a);
  });
  it('rotate() sau khi thành công → cùng nội dung nhận key mới', () => {
    mount({ q: 1 });
    const a = current.key;
    act(() => current.rotate());
    expect(current.key).not.toBe(a);
    expect(current.key).toBe('key-2');
  });
});
