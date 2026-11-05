import { payloadFlag, payloadId, payloadNonNegInt, payloadNumericString, payloadQuantity, payloadText } from './pancake-payload';

const STRANGE: unknown[] = [null, undefined, {}, { a: 1 }, [], ['x'], true, false, () => 1, Symbol('s'), NaN, Infinity, -Infinity];

describe('payloadText', () => {
  it('chuỗi: cắt khoảng trắng đầu cuối', () => {
    expect(payloadText('  GHN  ')).toBe('GHN');
  });
  it('số hữu hạn → chuỗi', () => {
    expect(payloadText(123)).toBe('123');
    expect(payloadText(0)).toBe('0');
  });
  it.each([[''], ['   '], ['undefined'], ['null'], ['NaN'], ['[object Object]'], ['Chai [object Object]']])('chuỗi rác %j → null', (v) => {
    expect(payloadText(v)).toBeNull();
  });
  it.each(STRANGE.map((v) => [v]))('kiểu lạ %p → null', (v) => {
    expect(payloadText(v)).toBeNull();
  });
});

describe('payloadId', () => {
  it('chuỗi và số nguyên an toàn', () => {
    expect(payloadId('9006')).toBe('9006');
    expect(payloadId(9006)).toBe('9006');
    expect(payloadId(' abc-1 ')).toBe('abc-1');
  });
  it.each([[1.5], [1e21], [Number.MAX_SAFE_INTEGER + 2], ['[object Object]'], [''], ...STRANGE.map((v) => [v])])('%p → null', (v) => {
    expect(payloadId(v)).toBeNull();
  });
});

describe('payloadNonNegInt', () => {
  it('số nguyên và chuỗi toàn chữ số', () => {
    expect(payloadNonNegInt(269000)).toBe(269000);
    expect(payloadNonNegInt('269000')).toBe(269000);
    expect(payloadNonNegInt(' 269000 ')).toBe(269000);
    expect(payloadNonNegInt(0)).toBe(0);
  });
  it('chuỗi có tối đa hai số lẻ: nhận khi giá trị nguyên, hoặc khi được phép làm tròn', () => {
    expect(payloadNonNegInt('269000.00')).toBe(269000);
    expect(payloadNonNegInt('12.5')).toBeNull();
    expect(payloadNonNegInt('12.5', { round: true })).toBe(13);
  });
  it('"12.000" (dấu chấm ngăn nghìn của Việt Nam) không bao giờ thành 12', () => {
    expect(payloadNonNegInt('12.000')).toBeNull();
    expect(payloadNonNegInt('12.000', { round: true })).toBeNull();
    expect(payloadNonNegInt('269.000đ', { round: true })).toBeNull();
    expect(payloadNonNegInt('1,234')).toBeNull();
  });
  it('số thập phân: từ chối, hoặc làm tròn khi được phép', () => {
    expect(payloadNonNegInt(12000.5)).toBeNull();
    expect(payloadNonNegInt(12000.5, { round: true })).toBe(12001);
  });
  it.each([[-1], [-0.4], ['-5'], [1e21], [Number.MAX_SAFE_INTEGER + 2], ['1e3'], ['0x10'], ...STRANGE.map((v) => [v])])('%p → null', (v) => {
    expect(payloadNonNegInt(v, { round: true })).toBeNull();
  });
});

describe('payloadQuantity', () => {
  it('số nguyên, chuỗi số, bỏ phần lẻ', () => {
    expect(payloadQuantity(5)).toBe(5);
    expect(payloadQuantity('7')).toBe(7);
    expect(payloadQuantity(12.7)).toBe(12);
    expect(payloadQuantity('12.70')).toBe(12);
    expect(payloadQuantity(0)).toBe(0);
  });
  it('số âm giữ nguyên dấu để nơi gọi quyết định (POS cho bán lố kho)', () => {
    expect(payloadQuantity(-3)).toBe(-3);
    expect(payloadQuantity('-3')).toBe(-3);
  });
  it.each([[''], ['  '], ['abc'], ['1e3'], [1e12], [-1e12], [2_147_483_648], ...STRANGE.map((v) => [v])])('%p → null', (v) => {
    expect(payloadQuantity(v)).toBeNull();
  });
  it('đúng bằng trần Int của Postgres thì nhận', () => {
    expect(payloadQuantity(2_147_483_647)).toBe(2_147_483_647);
  });
});

describe('payloadFlag', () => {
  it.each([[true], [1], ['1'], ['true'], [' TRUE ']])('%p → bật', (v) => {
    expect(payloadFlag(v)).toBe(true);
  });
  it.each([[false], [0], ['0'], ['false'], [''], ['yes'], [2], ...STRANGE.filter((v) => v !== true).map((v) => [v])])('%p → tắt', (v) => {
    expect(payloadFlag(v)).toBe(false);
  });
});

describe('chuỗi số có phần lẻ (Pancake gửi "269000.000", "7.00")', () => {
  it('phần lẻ dài tùy ý được đọc như số rồi xử lý như nhánh số', () => {
    expect(payloadNonNegInt('269000.000')).toBe(269000);
    expect(payloadNonNegInt('269000.0000')).toBe(269000);
    expect(payloadNonNegInt(' 1000.000 ')).toBe(1000);
    expect(payloadNonNegInt('12.3456')).toBeNull();
    expect(payloadNonNegInt('12.3456', { round: true })).toBe(12);
    expect(payloadNonNegInt('12.9', { trunc: true })).toBe(12);
    expect(payloadQuantity('7.00')).toBe(7);
    expect(payloadQuantity('12.3456')).toBe(12);
    expect(payloadQuantity('-5.5')).toBe(-5);
    expect(payloadQuantity('1000.000')).toBe(1000);
  });
  it('đúng mẫu ngăn nghìn kiểu Việt Nam ("5.000", "269.000", "1.234.567") bị từ chối, kể cả "5.123"', () => {
    for (const s of ['12.000', '269.000', '5.000', '5.123', '0.000', '1.234.567', '999.999']) {
      expect(payloadNonNegInt(s)).toBeNull();
      expect(payloadNonNegInt(s, { round: true })).toBeNull();
      expect(payloadQuantity(s)).toBeNull();
      expect(payloadNumericString(s)).toBeNull();
    }
    expect(payloadQuantity('-1.000')).toBeNull();
  });
  it('cùng giá trị nhưng kiểu số thì không thể là ngăn nghìn: 5.123 → 5', () => {
    expect(payloadQuantity(5.123)).toBe(5);
    expect(payloadNonNegInt(5.123, { round: true })).toBe(5);
  });
  it('payloadNumericString: chỉ chuỗi số thập phân, có thể âm; không có -0', () => {
    expect(payloadNumericString('12.5')).toBe(12.5);
    expect(payloadNumericString('-3')).toBe(-3);
    expect(payloadNumericString('abc')).toBeNull();
    expect(payloadNumericString('1e3')).toBeNull();
    expect(payloadNumericString('')).toBeNull();
    expect(Object.is(payloadQuantity('-0.4'), 0)).toBe(true);
  });
});
