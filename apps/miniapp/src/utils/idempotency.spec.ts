import { describe, it, expect, vi } from 'vitest';
import { newIdempotencyKey, newDeviceId, createOrderKeyRing } from './idempotency';

describe('createOrderKeyRing — Idempotency-Key đặt hàng theo nội dung đơn (R2-MONEY-2)', () => {
  const body = { addressId: 'a1', paymentMethod: 'WALLET', pointsToUse: 0, itemIds: ['i1'] };

  it('bấm lại cùng nội dung sau lỗi mạng/quá thời gian → cùng key (server trả lại đơn đã tạo, không đặt đơn thứ hai)', () => {
    const ring = createOrderKeyRing();
    const first = ring.keyFor(body);
    expect(ring.keyFor({ ...body })).toBe(first);
  });

  it('tổng tiền khách đang thấy đổi (báo giá mới) không phải nội dung khác → vẫn cùng key', () => {
    const ring = createOrderKeyRing();
    expect(ring.keyFor({ ...body, expectedTotal: 100 })).toBe(ring.keyFor({ ...body, expectedTotal: 120 }));
  });

  it('thứ tự khoá trong body không làm đổi key', () => {
    const ring = createOrderKeyRing();
    expect(ring.keyFor({ paymentMethod: 'WALLET', addressId: 'a1', itemIds: ['i1'], pointsToUse: 0 })).toBe(ring.keyFor(body));
  });

  it('đổi địa chỉ / cách trả tiền / món → key mới; quay về nội dung cũ → lại key cũ', () => {
    const ring = createOrderKeyRing();
    const k1 = ring.keyFor(body);
    const k2 = ring.keyFor({ ...body, paymentMethod: 'COD' });
    const k3 = ring.keyFor({ ...body, addressId: 'a2' });
    const k4 = ring.keyFor({ ...body, itemIds: ['i1', 'i2'] });
    expect(new Set([k1, k2, k3, k4]).size).toBe(4);
    expect(ring.keyFor(body)).toBe(k1);
  });

  it('peek: xem key đã cấp cho nội dung này mà không cấp key mới', () => {
    const make = vi.fn().mockReturnValueOnce('k1').mockReturnValueOnce('k2');
    const ring = createOrderKeyRing(make);
    expect(ring.peek(body)).toBeUndefined();
    expect(make).not.toHaveBeenCalled();
    const k1 = ring.keyFor(body);
    expect(ring.peek({ ...body, expectedTotal: 5 })).toBe(k1);
    expect(ring.peek({ ...body, paymentMethod: 'COD' })).toBeUndefined();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('đặt thành công → reset: đơn sau dù giống hệt là đơn mới, key mới', () => {
    const ring = createOrderKeyRing();
    const k1 = ring.keyFor(body);
    ring.reset();
    expect(ring.keyFor(body)).not.toBe(k1);
  });
});

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
