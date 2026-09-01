import { describe, it, expect } from 'vitest';
import { newIdempotencyKey } from './idempotency';

describe('newIdempotencyKey', () => {
  it('sinh chuỗi không rỗng', () => {
    expect(newIdempotencyKey().length).toBeGreaterThan(0);
  });

  it('mỗi lần gọi ra key khác nhau (tránh 2 request khác nhau vô tình trùng key)', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});
