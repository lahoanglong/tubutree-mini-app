import { assertListable, COUPON_TITLE_MAX } from './coupon-input-rules';

describe('assertListable: mã hiện ở mục Nhận mã', () => {
  it('mã CLAIM chung (không thuộc lô) bật listed được', () => {
    expect(() => assertListable({ scope: 'CLAIM', batch: null }, true)).not.toThrow();
  });

  it('mã thuộc lô thẻ in: 400 nói rõ lô thẻ', () => {
    expect(() => assertListable({ scope: 'CLAIM', batch: 'LOT-1' }, true)).toThrow(/lô thẻ/);
  });

  it('mã không phải CLAIM (đã nằm sẵn trong ví khách đủ điều kiện): 400', () => {
    for (const scope of ['PUBLIC', 'TIER', 'USER_GROUP', 'BIRTHDAY', 'INVITE']) {
      expect(() => assertListable({ scope, batch: null }, true)).toThrow(/nhận qua thẻ/);
    }
  });

  it('tắt hoặc không đụng tới listed thì không chặn, kể cả mã lô', () => {
    expect(() => assertListable({ scope: 'CLAIM', batch: 'LOT-1' }, false)).not.toThrow();
    expect(() => assertListable({ scope: 'PUBLIC', batch: 'LOT-1' }, undefined)).not.toThrow();
  });

  it('tên hiển thị tối đa 60 ký tự', () => {
    expect(COUPON_TITLE_MAX).toBe(60);
  });
});
