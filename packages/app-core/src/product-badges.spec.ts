import { describe, expect, it } from 'vitest';
import { isNewProduct, NEW_PRODUCT_DAYS } from './product-badges';

const DAY = 864e5;
const NOW = Date.parse('2026-10-29T03:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('isNewProduct', () => {
  it('tạo cách đây 29 ngày thì còn là hàng mới', () => {
    expect(isNewProduct(ago(29), NOW)).toBe(true);
  });

  it('tạo cách đây 31 ngày thì hết là hàng mới', () => {
    expect(isNewProduct(ago(31), NOW)).toBe(false);
  });

  it('đúng mốc 30 ngày vẫn tính mới, quá một giây thì không', () => {
    expect(NEW_PRODUCT_DAYS).toBe(30);
    expect(isNewProduct(ago(30), NOW)).toBe(true);
    expect(isNewProduct(new Date(NOW - 30 * DAY - 1000).toISOString(), NOW)).toBe(false);
  });

  it('thiếu hoặc sai định dạng ngày tạo thì không dán nhãn', () => {
    expect(isNewProduct(undefined, NOW)).toBe(false);
    expect(isNewProduct(null, NOW)).toBe(false);
    expect(isNewProduct('', NOW)).toBe(false);
    expect(isNewProduct('không phải ngày', NOW)).toBe(false);
  });

  it('đồng hồ máy khách chậm vài phút so với máy chủ: SP vừa tạo vẫn mới', () => {
    expect(isNewProduct(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe(true);
  });

  it('nhận cả Date và số mili giây cho `now`', () => {
    expect(isNewProduct(ago(1), new Date(NOW))).toBe(true);
    expect(isNewProduct(ago(40), new Date(NOW))).toBe(false);
  });
});
