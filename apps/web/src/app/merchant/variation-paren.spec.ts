import { describe, expect, it } from 'vitest';
import { variationParen } from './variation-paren';

describe('variationParen: " (nhãn)" sau tên sản phẩm trên màn Thương nhân', () => {
  it('có tên: " (tên)"', () => {
    expect(variationParen('500ml')).toBe(' (500ml)');
    expect(variationParen('  1kg  ')).toBe(' (1kg)');
  });

  it('trống / null / undefined / chỉ "[object Object]": rỗng, không để lại "()" treo', () => {
    for (const name of ['', '   ', null, undefined, '[object Object]', ' [OBJECT Object] [object Object] ']) {
      expect(variationParen(name)).toBe('');
    }
  });

  it('"[object Object]" dính sau tên thật thì gỡ ra', () => {
    expect(variationParen('Can 5L [object Object]')).toBe(' (Can 5L)');
  });

  it('"Mặc định" vẫn hiện, trừ khi hideDefault (hàng cần gửi)', () => {
    expect(variationParen('Mặc định')).toBe(' (Mặc định)');
    expect(variationParen('Mặc định', true)).toBe('');
    expect(variationParen('500ml', true)).toBe(' (500ml)');
  });
});
