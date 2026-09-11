import { describe, it, expect, vi } from 'vitest';
import { newIdempotencyKey, newDeviceId } from './idempotency';

describe('newIdempotencyKey', () => {
  it('sinh chuỗi không rỗng', () => {
    expect(newIdempotencyKey().length).toBeGreaterThan(0);
  });

  it('mỗi lần gọi ra key khác nhau (tránh 2 request khác nhau vô tình trùng key)', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});

describe('newDeviceId — định danh thiết bị cho đăng nhập khách', () => {
  it('dùng crypto.randomUUID khi có', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555');
    expect(newDeviceId()).toBe('d_11111111-2222-4333-8444-555555555555');
    spy.mockRestore();
  });

  it('không có randomUUID → dùng getRandomValues (16 byte hex), KHÔNG rơi về Math.random', () => {
    const orig = crypto.randomUUID;
    // @ts-expect-error giả lập WebView thiếu randomUUID
    crypto.randomUUID = undefined;
    const spy = vi.spyOn(Math, 'random');
    try {
      const id = newDeviceId();
      expect(id).toMatch(/^d_[0-9a-f]{32}$/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      crypto.randomUUID = orig;
      spy.mockRestore();
    }
  });

  it('hai lần gọi ra 2 id khác nhau', () => {
    expect(newDeviceId()).not.toBe(newDeviceId());
  });
});
