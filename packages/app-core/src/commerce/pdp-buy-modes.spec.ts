import { describe, expect, it } from 'vitest';
import { pdpBuyModeOrRetail, pdpBuyModes } from './pdp-buy-modes';

const cmp = (savedPct: number) => ({ savedPct, savedVnd: 1000, bottlesReplaced: 2, unitPriceBottle: 1, unitPriceRefill: 1 }) as never;

describe('pdpBuyModes', () => {
  it('chỉ Mua lẻ: không có dải', () => {
    expect(pdpBuyModes({ refill: null, subscribe: false, subscribePct: 12 })).toBeNull();
  });

  it('đủ ba chế độ: Mua lẻ đứng đầu, dòng phụ chỉ khi có số', () => {
    const modes = pdpBuyModes({ refill: { comparison: cmp(34), pack: 'túi' }, subscribe: true, subscribePct: 12 })!;
    expect(modes.map((m) => [m.key, m.label, m.tag])).toEqual([
      ['retail', 'Mua lẻ', null],
      ['refill', 'Túi Refill', 'Tiết kiệm ~34%'],
      ['subscribe', 'Định kỳ', 'Tiết kiệm 12%'],
    ]);
  });

  it('gói can, không so được giá, định kỳ không có %: không nêu số', () => {
    const modes = pdpBuyModes({ refill: { comparison: null, pack: 'can' }, subscribe: true, subscribePct: null })!;
    expect(modes.map((m) => [m.label, m.tag])).toEqual([
      ['Mua lẻ', null],
      ['Can Refill', null],
      ['Định kỳ', null],
    ]);
  });

  it('thẻ cũ không có pack thì coi là túi', () => {
    expect(pdpBuyModes({ refill: { comparison: null }, subscribe: false, subscribePct: null })![1]!.label).toBe('Túi Refill');
  });
});

describe('pdpBuyModeOrRetail', () => {
  it('chế độ không còn trong dải (đổi phân loại hết hàng) thì về Mua lẻ', () => {
    const modes = pdpBuyModes({ refill: { comparison: null }, subscribe: false, subscribePct: null });
    expect(pdpBuyModeOrRetail(modes, 'subscribe')).toBe('retail');
    expect(pdpBuyModeOrRetail(modes, 'refill')).toBe('refill');
    expect(pdpBuyModeOrRetail(null, 'refill')).toBe('retail');
  });
});
