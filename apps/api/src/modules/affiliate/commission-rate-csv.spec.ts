import { DEFAULT_AFFILIATE_MAX_RATE_PCT, parseRateCsv, rateProblem, sanitizeMaxRate } from './commission-rate-csv';

describe('rateProblem — % hoa hồng CTV là phần trăm (10 = 10%)', () => {
  it.each([0, 5, 7.5, 7.25, 50])('nhận %p với trần 50', (r) => {
    expect(rateProblem(r, 50)).toBeNull();
  });

  it.each([
    ['âm', -1, 'không được âm'],
    ['vượt trần', 50.01, 'vượt trần 50%'],
    ['ba chữ số thập phân', 7.125, 'tối đa 2 chữ số thập phân'],
    ['NaN', Number.NaN, 'phải là số'],
    ['chuỗi', '10', 'phải là số'],
    ['null', null, 'phải là số'],
  ])('từ chối %s', (_label, r, msg) => {
    expect(rateProblem(r, 50)).toContain(msg);
  });

  it('trần 0 → chỉ nhận 0', () => {
    expect(rateProblem(0, 0)).toBeNull();
    expect(rateProblem(1, 0)).toContain('vượt trần 0%');
  });
});

describe('sanitizeMaxRate', () => {
  it('số 0–100 giữ nguyên; giá trị hỏng → mặc định', () => {
    expect(sanitizeMaxRate(30)).toBe(30);
    expect(sanitizeMaxRate(0)).toBe(0);
    for (const bad of [-1, 101, '30', null, Number.NaN, { x: 1 }]) expect(sanitizeMaxRate(bad)).toBe(DEFAULT_AFFILIATE_MAX_RATE_PCT);
  });
});

describe('parseRateCsv — CSV "sku,%" dán từ Excel', () => {
  it('phẩy / chấm phẩy / tab, có hoặc không dấu %, bỏ dòng trống và dòng tiêu đề', () => {
    const rows = parseRateCsv('SKU,% hoa hồng\nA1,10\n\nB2;7,5\nC3\t12%\nD4, 8 %\n');
    expect(rows.map((r) => [r.line, r.sku, r.rate, r.problem])).toEqual([
      [2, 'A1', 10, null],
      [4, 'B2', 7.5, null],
      [5, 'C3', 12, null],
      [6, 'D4', 8, null],
    ]);
  });

  it('dòng đầu là SKU thật (không phải tiêu đề) → giữ, kể cả SKU bắt đầu bằng "MA"', () => {
    expect(parseRateCsv('MA001,10').map((r) => [r.sku, r.rate])).toEqual([['MA001', 10]]);
    expect(parseRateCsv('sku,10').map((r) => [r.sku, r.rate])).toEqual([['sku', 10]]);
  });

  it('không bỏ im lặng dòng hỏng: trả về kèm lỗi và đúng số dòng', () => {
    const rows = parseRateCsv('A1,abc\n,10\nB2\nC3,7,5\nD4,1,2,3\nE5;-3\nF6;1e2');
    expect(rows.map((r) => [r.line, r.sku, r.rate, r.problem !== null])).toEqual([
      [1, 'A1', null, true],
      [2, '', null, true],
      [3, 'B2', null, true],
      [4, 'C3', null, true],
      [5, 'D4', null, true],
      [6, 'E5', null, true],
      [7, 'F6', null, true],
    ]);
    expect(rows[3]!.problem).toContain('dấu chấm');
    expect(rows[4]!.problem).toContain('thừa cột');
  });

  it('cột thừa trống ở cuối (Excel xuất "A1,10,,") vẫn đọc được', () => {
    expect(parseRateCsv('A1,10,,').map((r) => [r.sku, r.rate, r.problem])).toEqual([['A1', 10, null]]);
  });

  it('CRLF của Windows', () => {
    expect(parseRateCsv('A1,10\r\nB2,5\r\n').map((r) => r.rate)).toEqual([10, 5]);
  });
});
