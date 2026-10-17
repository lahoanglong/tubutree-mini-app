import { describe, expect, it } from 'vitest';
import { safeAreaPad, safeAreaPadX } from './safe-area';

// viewport-fit=cover: iPhone xoay ngang có tai thỏ, phần tử fixed/overlay phải tự chừa inset trái/phải.
describe('safeAreaPadX', () => {
  it('padding trái/phải không nhỏ hơn mức gốc và không nhỏ hơn inset của tai thỏ', () => {
    expect(safeAreaPadX('1rem')).toEqual({
      paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
    });
  });

  it('nhận mức gốc khác (vd 0 cho khung không có lề)', () => {
    expect(safeAreaPadX('0px').paddingLeft).toBe('max(0px, env(safe-area-inset-left, 0px))');
  });
});

describe('safeAreaPad', () => {
  it('chỉ chừa một phía: ngăn kéo dính mép phải chỉ cần inset phải', () => {
    expect(safeAreaPad('right', '0px')).toEqual({ paddingRight: 'max(0px, env(safe-area-inset-right, 0px))' });
    expect(safeAreaPad('left', '1rem')).toEqual({ paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))' });
  });
});
