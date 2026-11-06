import { describe, expect, it } from 'vitest';
import { MERCHANT_PRICE_MAX, MERCHANT_PRICE_MIN, merchantPriceError, parseMerchantPrice } from './merchant-price';

describe('parseMerchantPrice: dấu chấm là ngăn nghìn', () => {
  it.each([
    ['5.000', 5000],
    ['120.000', 120000],
    ['1.250.000', 1250000],
    ['100.000.000', 100000000],
    [' 120.000 ', 120000],
    ['120.000đ', 120000],
    ['120.000 ₫', 120000],
    ['120000', 120000],
    ['5000', 5000],
    ['0', 0],
  ])('%j → %j', (raw, expected) => {
    expect(parseMerchantPrice(raw)).toBe(expected);
  });

  it.each([[''], ['  '], ['abc'], ['12.5'], ['1.5'], ['0.500'], ['12.34'], ['1234.567'], ['1,000'], ['120.00'], ['-5.000'], ['1e5'], ['120k'], ['9'.repeat(20)]])(
    '%j không phải giá → null',
    (raw) => {
      expect(parseMerchantPrice(raw)).toBeNull();
    },
  );
});

describe('merchantPriceError', () => {
  it('đọc không được → bảo nhập số đồng kèm ví dụ', () => {
    expect(merchantPriceError(null)).toBe('Nhập giá bằng số đồng, ví dụ 120.000 hoặc 120000.');
  });

  it('dưới 1.000đ và trên 100.000.000đ → báo trần, khớp API', () => {
    expect(MERCHANT_PRICE_MIN).toBe(1000);
    expect(MERCHANT_PRICE_MAX).toBe(100_000_000);
    expect(merchantPriceError(999)).toBe('Giá bán tối thiểu 1.000đ.');
    expect(merchantPriceError(0)).toBe('Giá bán tối thiểu 1.000đ.');
    expect(merchantPriceError(100_000_001)).toBe('Giá bán tối đa 100.000.000đ.');
  });

  it('đúng trần thì không lỗi', () => {
    expect(merchantPriceError(1000)).toBeNull();
    expect(merchantPriceError(120_000)).toBeNull();
    expect(merchantPriceError(100_000_000)).toBeNull();
  });

  it('"5" gõ thiếu ngăn nghìn vẫn báo dưới 1.000đ chứ không lưu 5đ', () => {
    expect(merchantPriceError(parseMerchantPrice('5'))).toBe('Giá bán tối thiểu 1.000đ.');
  });
});
