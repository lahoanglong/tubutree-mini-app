import { dealerPriceRowsFromJson, parseDealerPriceCsv, parseVndAmount } from './dealer-price-import';

describe('parseVndAmount — số tiền đồng nguyên kiểu Việt Nam/Excel', () => {
  it.each([
    ['185000', 185_000],
    ['185.000', 185_000],
    ['185,000', 185_000],
    ['185 000', 185_000],
    ['185\u00a0000', 185_000],
    ['1.250.000', 1_250_000],
    ['1,250,000', 1_250_000],
    ['185.000đ', 185_000],
    ['185.000 VND', 185_000],
    ['240,000', 240_000],
    ['0', 0],
  ])('"%s" → %d', (raw, n) => {
    expect(parseVndAmount(raw)).toBe(n);
  });

  it.each(['185.5', '1.25', '185.000,00', '1,250.000', '1234.567', '12.34.567', 'abc', '', '-185000', '1e5', '185000.00'])('mơ hồ / sai: "%s" → null', (raw) => {
    expect(parseVndAmount(raw)).toBeNull();
  });
});

describe('parseDealerPriceCsv', () => {
  it('phẩy / chấm phẩy / tab; "240,000" bị Excel tách cột vẫn ghép đúng; bỏ dòng tiêu đề', () => {
    const rows = parseDealerPriceCsv('SKU,Giá sỉ\nA1,185.000\nB2,240,000\nC3;1.250.000\nD4\t185 000\nE5,185000');
    expect(rows.map((r) => [r.line, r.sku, r.price, r.problem])).toEqual([
      [2, 'A1', 185_000, null],
      [3, 'B2', 240_000, null],
      [4, 'C3', 1_250_000, null],
      [5, 'D4', 185_000, null],
      [6, 'E5', 185_000, null],
    ]);
  });

  it('không bỏ im lặng dòng hỏng: trả về kèm lỗi, đúng số dòng', () => {
    const rows = parseDealerPriceCsv('A1,185.5\n,1000\nB2\nC3;1;2\nD4,0\nE5,1,2');
    expect(rows.map((r) => [r.line, r.price, r.problem !== null])).toEqual([
      [1, null, true],
      [2, null, true],
      [3, null, true],
      [4, null, true],
      [5, null, true],
      [6, null, true],
    ]);
    expect(rows[3]!.problem).toContain('thừa cột');
    expect(rows[0]!.problem).toContain('số đồng nguyên');
  });

  it('rows JSON: giá phải là số nguyên dương', () => {
    expect(dealerPriceRowsFromJson([{ sku: 'A', price: 100 }, { sku: 'B', price: 1.5 }, { sku: '', price: 1 }, { sku: 'C', price: '100' }]).map((r) => [r.price, r.problem !== null])).toEqual([
      [100, false],
      [null, true],
      [1, true],
      [null, true],
    ]);
  });
});
