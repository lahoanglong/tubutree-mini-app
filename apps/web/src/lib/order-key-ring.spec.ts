import { describe, expect, it, vi } from 'vitest';
import { createOrderKeyRing, newIdempotencyKey } from './order-key-ring';

describe('createOrderKeyRing — Idempotency-Key đặt hàng theo nội dung đơn (như Mini App)', () => {
  const body = { addressId: 'a1', paymentMethod: 'WALLET', pointsToUse: 0, itemIds: ['i1'] };

  it('bấm lại cùng nội dung sau lỗi mạng/quá thời gian → cùng key', () => {
    const ring = createOrderKeyRing();
    expect(ring.keyFor({ ...body })).toBe(ring.keyFor(body));
  });

  it('tổng tiền khách đang thấy (expectedTotal, quotedZeroTotal) đổi vẫn cùng key', () => {
    const ring = createOrderKeyRing();
    expect(ring.keyFor({ ...body, expectedTotal: 100, quotedZeroTotal: true })).toBe(ring.keyFor({ ...body, expectedTotal: 120 }));
  });

  it('thứ tự khoá và khoá undefined không làm đổi key', () => {
    const ring = createOrderKeyRing();
    expect(ring.keyFor({ itemIds: ['i1'], pointsToUse: 0, addressId: 'a1', paymentMethod: 'WALLET', note: undefined })).toBe(ring.keyFor(body));
  });

  it('đổi địa chỉ / cách trả tiền / món / phiếu rác → key mới; quay lại nội dung cũ → key cũ', () => {
    const ring = createOrderKeyRing();
    const keys = [
      ring.keyFor(body),
      ring.keyFor({ ...body, paymentMethod: 'COD' }),
      ring.keyFor({ ...body, addressId: 'a2' }),
      ring.keyFor({ ...body, itemIds: ['i1', 'i2'] }),
      ring.keyFor({ ...body, wasteRequestId: 'w1' }),
    ];
    expect(new Set(keys).size).toBe(5);
    expect(ring.keyFor(body)).toBe(keys[0]);
  });

  it('reset sau khi đặt thành công: đơn sau giống hệt vẫn là key mới', () => {
    const make = vi.fn().mockReturnValueOnce('k1').mockReturnValueOnce('k2');
    const ring = createOrderKeyRing(make);
    expect(ring.keyFor(body)).toBe('k1');
    ring.reset();
    expect(ring.keyFor(body)).toBe('k2');
  });
});

describe('newIdempotencyKey', () => {
  it('mỗi lần một key khác nhau', () => {
    expect(new Set(Array.from({ length: 30 }, () => newIdempotencyKey())).size).toBe(30);
  });

  it('thiếu crypto.randomUUID (trình duyệt cũ) vẫn ra key không rỗng và khác nhau', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const a = newIdempotencyKey();
      expect(a.length).toBeGreaterThan(0);
      expect(newIdempotencyKey()).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
