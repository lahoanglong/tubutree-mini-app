import { BROKEN_VARIANT_NAME_MARKER, isBrokenVariantName, variantAttributes, variantLabel } from './pancake-variant-fields';

// Mẫu đọc từ Pancake thật: mỗi phân loại là một object, kèm id và keyValue.
const PANCAKE_SAMPLE = [{ id: 'ecbe456a-1111-4222-8333-444455556666', name: 'PHÂN LOẠI', value: '1 chai', keyValue: '1 CHAI' }];

describe('variantLabel — nhãn phân loại từ payload Pancake', () => {
  it('mảng {name, value} kèm id/keyValue (dạng Pancake trả thật): nhãn là value, không phải "[object Object]"', () => {
    expect(variantLabel(PANCAKE_SAMPLE)).toBe('1 chai');
  });

  it('nhiều phân loại: value nối " - " đúng thứ tự Pancake', () => {
    expect(
      variantLabel([
        { name: 'MÀU', value: 'Đỏ' },
        { name: 'SIZE', value: 'L' },
        { name: 'CHẤT LIỆU', value: 'Tre' },
      ]),
    ).toBe('Đỏ - L - Tre');
  });

  it('mảng {k, v} và {key, value}', () => {
    expect(variantLabel([{ k: 'size', v: '100ml' }, { k: 'màu', v: 'xanh' }])).toBe('100ml - xanh');
    expect(variantLabel([{ key: 'size', value: '100ml' }, { key: 'màu', value: 'xanh' }])).toBe('100ml - xanh');
  });

  it('mảng chuỗi', () => {
    expect(variantLabel(['1 chai', '500ml'])).toBe('1 chai - 500ml');
  });

  it('object {tên: giá trị} (dạng seed và dạng tài liệu cũ)', () => {
    expect(variantLabel({ size: '100ml' })).toBe('100ml');
    expect(variantLabel({ size: '300ml', scent: 'sả chanh' })).toBe('300ml - sả chanh');
  });

  it('object mà giá trị là object {name|value}', () => {
    expect(variantLabel({ color: { name: 'Đỏ' }, size: { value: 'L' } })).toBe('Đỏ - L');
    expect(variantLabel({ color: { name: 'MÀU', value: 'Xanh' } })).toBe('Xanh');
  });

  it('giá trị số (cả trong mảng và trong object)', () => {
    expect(variantLabel({ count: 10 })).toBe('10');
    expect(variantLabel([{ name: 'Số lượng', value: 6 }, 12])).toBe('6 - 12');
  });

  it('cắt khoảng trắng hai đầu từng giá trị', () => {
    expect(variantLabel([{ name: 'A', value: '  1 chai  ' }])).toBe('1 chai');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['mảng rỗng', []],
    ['object rỗng', {}],
    ['chuỗi rỗng', ''],
    ['số', 5],
    ['mảng phần tử rác', [null, undefined, true, [], [['x']], () => 1, Symbol('x')]],
    ['mảng chuỗi rỗng và toàn khoảng trắng', ['', '   ', '\t\n']],
    ['value rỗng', [{ name: 'A', value: '' }, { name: 'B', value: '  ' }]],
    ['value là null', [{ name: 'A', value: null }, { k: 'B', v: undefined }]],
    ['object thiếu cả name lẫn value', [{ id: 'x', keyValue: 'Y' }]],
    ['object có giá trị rác', { a: null, b: undefined, c: '', d: ' ', e: {}, f: [] }],
    ['số không hữu hạn', [NaN, Infinity, { value: -Infinity }]],
  ])('%s: trả null để nơi gọi rơi về tên sản phẩm', (_label, input) => {
    expect(variantLabel(input)).toBeNull();
  });

  it('bỏ phần tử rác nhưng giữ phần tử tốt và thứ tự', () => {
    expect(variantLabel([null, { name: 'A', value: '1 chai' }, 42, {}, '', 'cuối'])).toBe('1 chai - 42 - cuối');
  });

  it('KHÔNG bao giờ trả chuỗi chứa "[object Object]", kể cả khi giá trị lồng sâu hoặc đã chứa sẵn chuỗi đó', () => {
    const inputs: unknown[] = [
      [{ name: 'A', value: { nested: { deep: 1 } } }],
      [{ name: 'A', value: [{ x: 1 }] }],
      { a: { b: { c: 'x' } } },
      { a: { name: { name: 'x' } } },
      [{ name: 'A', value: '[object Object]' }],
      ['[object Object] - [object Object]'],
      [{ value: { toString: () => '[object Object]' } }],
      [{ name: 'A', value: new Date(0) }],
      [new Map([['a', 1]])],
    ];
    for (const input of inputs) {
      const out = variantLabel(input);
      expect(out === null || !out.includes(BROKEN_VARIANT_NAME_MARKER)).toBe(true);
    }
  });

  it('giá trị đã chứa chuỗi hỏng bị bỏ, phần còn lại vẫn thành nhãn', () => {
    expect(variantLabel([{ name: 'A', value: '[object Object]' }, { name: 'B', value: 'L' }])).toBe('L');
  });
});

describe('variantAttributes — chuẩn hoá thành {tên: giá trị}', () => {
  it('mảng {name, value}: khoá là name, giá trị là value (id và keyValue bỏ đi)', () => {
    expect(variantAttributes(PANCAKE_SAMPLE)).toEqual({ 'PHÂN LOẠI': '1 chai' });
  });

  it('object {tên: giá trị} giữ nguyên; giá trị số thành chuỗi, giá trị object lấy value/name', () => {
    expect(variantAttributes({ size: '100ml', count: 10, color: { name: 'Đỏ' } })).toEqual({ size: '100ml', count: '10', color: 'Đỏ' });
  });

  it('phần tử không có tên lấy khoá theo vị trí', () => {
    expect(variantAttributes(['1 chai', { value: '500ml' }])).toEqual({ option_1: '1 chai', option_2: '500ml' });
  });

  it('hai phân loại trùng tên không đè nhau', () => {
    expect(variantAttributes([{ name: 'MÀU', value: 'Đỏ' }, { name: 'MÀU', value: 'Xanh' }])).toEqual({ MÀU: 'Đỏ', 'MÀU (2)': 'Xanh' });
  });

  it.each([null, undefined, [], {}, '', 7, [null, '', { name: 'A' }]])('đầu vào rỗng hoặc rác %p: object rỗng', (input) => {
    expect(variantAttributes(input)).toEqual({});
  });

  it('khoá "__proto__" là khoá thường, không đổi nguyên mẫu', () => {
    const out = variantAttributes([{ name: '__proto__', value: 'x' }]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['__proto__']);
  });
});

describe('isBrokenVariantName', () => {
  it('nhận ra tên chứa "[object Object]" ở bất kỳ vị trí nào', () => {
    expect(isBrokenVariantName('[object Object]')).toBe(true);
    expect(isBrokenVariantName('[object Object] - [object Object]')).toBe(true);
    expect(isBrokenVariantName('Chai [object Object]')).toBe(true);
  });

  it('tên bình thường, rỗng hoặc không phải chuỗi: false', () => {
    expect(isBrokenVariantName('1 chai')).toBe(false);
    expect(isBrokenVariantName('[object]')).toBe(false);
    expect(isBrokenVariantName('')).toBe(false);
    expect(isBrokenVariantName(null)).toBe(false);
    expect(isBrokenVariantName(undefined)).toBe(false);
  });
});
