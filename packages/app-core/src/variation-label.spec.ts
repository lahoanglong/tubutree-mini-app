import { describe, expect, it } from 'vitest';
import { DEFAULT_VARIATION_LABEL, joinDetailParts, joinVariationLine, variationLabel } from './variation-label';

describe('variationLabel: nhãn phân loại để hiện cho khách', () => {
  it('có tên thì trả tên đã cắt khoảng trắng đầu cuối, dù có bao nhiêu phân loại', () => {
    expect(variationLabel('Chai 500ml')).toBe('Chai 500ml');
    expect(variationLabel('  Chai 500ml  ', 1)).toBe('Chai 500ml');
    expect(variationLabel('Chai 500ml', 3)).toBe('Chai 500ml');
  });

  it('một phân loại duy nhất mà tên trống / toàn khoảng trắng / null / undefined: ẩn (null)', () => {
    for (const name of ['', ' ', '   \t ', null, undefined]) {
      expect(variationLabel(name, 1)).toBeNull();
      expect(variationLabel(name, 0)).toBeNull();
      expect(variationLabel(name)).toBeNull();
    }
  });

  it('nhiều phân loại mà tên trống / toàn khoảng trắng / null / undefined: "Mặc định"', () => {
    for (const name of ['', ' ', '\n ', null, undefined]) {
      expect(variationLabel(name, 2)).toBe('Mặc định');
      expect(variationLabel(name, 5)).toBe(DEFAULT_VARIATION_LABEL);
    }
  });

  it('chính tên "Mặc định" do sàn đặt vẫn giữ nguyên, kể cả khi chỉ có một phân loại', () => {
    expect(variationLabel('Mặc định', 1)).toBe('Mặc định');
  });

  it('tên chỉ là "[object Object]" (object bị ép chuỗi) coi như tên trống, không phân biệt hoa thường', () => {
    for (const name of ['[object Object]', '  [object Object]  ', '[OBJECT object]', '[object Object] [object Object]', '[object Object][object Object]']) {
      expect(variationLabel(name, 1)).toBeNull();
      expect(variationLabel(name)).toBeNull();
      expect(variationLabel(name, 3)).toBe('Mặc định');
    }
  });

  it('"[object Object]" dính sau/trước/giữa tên thật thì gỡ ra, gộp khoảng trắng thừa', () => {
    expect(variationLabel('Can 5L [object Object]')).toBe('Can 5L');
    expect(variationLabel('Can 5L[object Object]', 2)).toBe('Can 5L');
    expect(variationLabel('[object Object] Can 5L', 2)).toBe('Can 5L');
    expect(variationLabel('Can [object Object] 5L')).toBe('Can 5L');
    expect(variationLabel('Can 5L [object Object] [object Object]')).toBe('Can 5L');
  });

  it('tên bình thường không bị đổi, kể cả khoảng trắng bên trong', () => {
    expect(variationLabel('Chai  500ml')).toBe('Chai  500ml');
    expect(variationLabel('[object]')).toBe('[object]');
    expect(variationLabel(42 as unknown as string)).toBeNull();
  });
});

describe('joinVariationLine: ghép nhãn vào sau tên không để lại dấu treo', () => {
  it('có nhãn: "base · nhãn"; đổi được dấu phân cách', () => {
    expect(joinVariationLine('Dầu gội', 'Chai 500ml')).toBe('Dầu gội · Chai 500ml');
    expect(joinVariationLine('Dầu gội', 'Chai 500ml', ' - ')).toBe('Dầu gội - Chai 500ml');
  });

  it('không có nhãn (null / undefined / rỗng): trả đúng base, không có " · ", " - " hay khoảng trắng thừa', () => {
    for (const label of [null, undefined, '']) {
      expect(joinVariationLine('Dầu gội', label)).toBe('Dầu gội');
      expect(joinVariationLine('Dầu gội', label, ' - ')).toBe('Dầu gội');
    }
  });

  it('đi cùng variationLabel: tên trống một phân loại không còn "Tên SP · "', () => {
    expect(joinVariationLine('Dầu gội', variationLabel('', 1))).toBe('Dầu gội');
    expect(joinVariationLine('Dầu gội', variationLabel('  ', 1))).toBe('Dầu gội');
    expect(joinVariationLine('Dầu gội', variationLabel('', 2))).toBe('Dầu gội · Mặc định');
  });
});

describe('joinDetailParts: nối các phần có chữ', () => {
  it('bỏ phần trống, null, undefined, false và dấu phân cách của nó', () => {
    expect(joinDetailParts([null, 'còn trả được 2'])).toBe('còn trả được 2');
    expect(joinDetailParts(['Chai 500ml', 'còn trả được 2'])).toBe('Chai 500ml · còn trả được 2');
    expect(joinDetailParts(['', '  ', undefined, false, 'SL 3'])).toBe('SL 3');
    expect(joinDetailParts([null, undefined])).toBe('');
  });

  it('bỏ phần chỉ còn "[object Object]" và gỡ chuỗi đó khỏi phần có chữ thật', () => {
    expect(joinDetailParts(['[object Object]', 'SL 3'])).toBe('SL 3');
    expect(joinDetailParts(['Chai 500ml', ' [object Object] [object Object] ', 'SL 3'])).toBe('Chai 500ml · SL 3');
    expect(joinDetailParts(['Can 5L [object Object]', 'SL 3'])).toBe('Can 5L · SL 3');
    expect(joinDetailParts(['[object Object]', null])).toBe('');
  });

  it('nhận dấu phân cách khác (khoảng trắng cho nhãn đọc màn hình)', () => {
    expect(joinDetailParts(['Trả Dầu gội', null], ' ')).toBe('Trả Dầu gội');
    expect(joinDetailParts(['Trả Dầu gội', 'Chai'], ' ')).toBe('Trả Dầu gội Chai');
  });
});
