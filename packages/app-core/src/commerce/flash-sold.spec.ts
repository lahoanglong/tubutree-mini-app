import { describe, expect, it } from 'vitest';
import { flashSoldText } from './flash-sold';

describe('flashSoldText', () => {
  it('chưa bán thì "Vừa mở bán", không in "Đã bán 0%"', () => {
    expect(flashSoldText(0, false)).toBe('Vừa mở bán');
  });
  it('1–89% in phần trăm', () => {
    expect(flashSoldText(1, false)).toBe('Đã bán 1%');
    expect(flashSoldText(68, false)).toBe('Đã bán 68%');
    expect(flashSoldText(89, false)).toBe('Đã bán 89%');
  });
  it('từ 90% là "Sắp hết", kể cả số vượt 100', () => {
    expect(flashSoldText(90, false)).toBe('Sắp hết');
    expect(flashSoldText(92, false)).toBe('Sắp hết');
    expect(flashSoldText(150, false)).toBe('Sắp hết');
  });
  it('hết suất thắng mọi phần trăm', () => {
    expect(flashSoldText(100, true)).toBe('Đã bán hết');
    expect(flashSoldText(0, true)).toBe('Đã bán hết');
  });
  it('số rác coi như chưa bán', () => {
    expect(flashSoldText(Number.NaN, false)).toBe('Vừa mở bán');
    expect(flashSoldText(-5, false)).toBe('Vừa mở bán');
  });
  it('làm tròn trước khi chia khoảng', () => {
    expect(flashSoldText(0.4, false)).toBe('Vừa mở bán');
    expect(flashSoldText(0.6, false)).toBe('Đã bán 1%');
    expect(flashSoldText(89.6, false)).toBe('Sắp hết');
  });
});
