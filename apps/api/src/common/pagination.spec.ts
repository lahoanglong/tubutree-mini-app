import 'reflect-metadata';
import { clampTake } from './pagination';

describe('clampTake', () => {
  it('thiếu hoặc không phải số → mặc định', () => {
    expect(clampTake(undefined, 100, 200)).toBe(100);
    expect(clampTake('abc', 100, 200)).toBe(100);
    expect(clampTake('', 100, 200)).toBe(100);
  });

  it('kẹp vào [1, max] và làm tròn xuống', () => {
    expect(clampTake('25', 100, 200)).toBe(25);
    expect(clampTake('0', 100, 200)).toBe(1);
    expect(clampTake('-5', 100, 200)).toBe(1);
    expect(clampTake('99999', 100, 200)).toBe(200);
    expect(clampTake('12.9', 100, 200)).toBe(12);
  });
});
