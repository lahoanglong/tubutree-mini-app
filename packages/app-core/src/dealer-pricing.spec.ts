import { describe, expect, it } from 'vitest';
import { DEALER_MAX_QTY, preorderQty, realDiscountPct } from './dealer-pricing';

describe('dealer-pricing', () => {
  it('preorderQty: chỉ tính phần vượt tồn, tồn âm coi như 0', () => {
    expect(preorderQty(3, 5)).toBe(0);
    expect(preorderQty(5, 5)).toBe(0);
    expect(preorderQty(8, 5)).toBe(3);
    expect(preorderQty(2, 0)).toBe(2);
    expect(preorderQty(2, -4)).toBe(2);
  });

  it('realDiscountPct: tính từ giá thật, làm tròn, không âm', () => {
    expect(realDiscountPct(100_000, 70_000)).toBe(30);
    expect(realDiscountPct(100_000, 80_000)).toBe(20);
    expect(realDiscountPct(3, 2)).toBe(33);
    expect(realDiscountPct(100_000, 100_000)).toBe(0);
    expect(realDiscountPct(100_000, 120_000)).toBe(0);
  });

  it('realDiscountPct: giá lẻ không hợp lệ thì 0, không NaN', () => {
    expect(realDiscountPct(0, 0)).toBe(0);
    expect(realDiscountPct(-5, 1)).toBe(0);
    expect(realDiscountPct(Number.NaN, 1)).toBe(0);
  });

  it('trần số lượng là số hợp lý, không phải tồn kho', () => {
    expect(DEALER_MAX_QTY).toBe(9999);
  });
});
