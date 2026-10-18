import { describe, expect, it } from 'vitest';
import { createOrderKeyRing } from './order-key-ring';

const counter = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('createOrderKeyRing', () => {
  it('cùng nội dung (thứ tự khoá khác nhau) thì cùng key; đổi nội dung thì key mới', () => {
    const ring = createOrderKeyRing(counter());
    const a = ring.keyFor({ x: 1, y: [1, 2] });
    expect(ring.keyFor({ y: [1, 2], x: 1 })).toBe(a);
    expect(ring.keyFor({ x: 2, y: [1, 2] })).not.toBe(a);
  });

  it('quay lại nội dung cũ thì lấy lại key cũ', () => {
    const ring = createOrderKeyRing(counter());
    const a = ring.keyFor({ x: 1 });
    ring.keyFor({ x: 2 });
    expect(ring.keyFor({ x: 1 })).toBe(a);
  });

  it('expectedTotal và quotedZeroTotal đi theo báo giá nên không đổi key', () => {
    const ring = createOrderKeyRing(counter());
    const a = ring.keyFor({ x: 1, expectedTotal: 100 });
    expect(ring.keyFor({ x: 1, expectedTotal: 120 })).toBe(a);
    expect(ring.keyFor({ x: 1, quotedZeroTotal: true })).toBe(a);
  });

  it('trường undefined bị bỏ qua', () => {
    const ring = createOrderKeyRing(counter());
    expect(ring.keyFor({ x: 1, note: undefined })).toBe(ring.keyFor({ x: 1 }));
  });

  it('peek không cấp key mới; reset xoá hết', () => {
    const ring = createOrderKeyRing(counter());
    expect(ring.peek({ x: 1 })).toBeUndefined();
    const a = ring.keyFor({ x: 1 });
    expect(ring.peek({ x: 1 })).toBe(a);
    ring.reset();
    expect(ring.peek({ x: 1 })).toBeUndefined();
    expect(ring.keyFor({ x: 1 })).not.toBe(a);
  });
});
