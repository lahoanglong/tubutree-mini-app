import { classifyDealerPrices, dealerPriceFloor, dealerPriceRowsFromJson, parseDealerPriceCsv, parseVndAmount } from './dealer-price-import';

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

describe('sàn giá sỉ theo chiết khấu tối đa cho đại lý (dealer.max_discount_pct)', () => {
  it.each([
    [200_000, 0.45, 110_000],
    [199_999, 0.45, 110_000],
    [200_000, 0.95, 20_000],
    [200_000, 0, 200_000],
    [200_000, 'x', 110_000],
    [200_000, -1, 110_000],
    [200_000, 2, 110_000],
    [200_000, undefined, 110_000],
  ])('giá lẻ %d, chiết khấu tối đa %p → sàn %d', (retail, maxDiscount, floor) => {
    expect(dealerPriceFloor(retail as number, maxDiscount)).toBe(floor);
  });

  const db = (retailPrice: number) =>
    ({
      variation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'v1', sku: 'A1', name: 'M', retailPrice, dealerPrices: null, product: { name: 'SP' } }]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }) as never;

  it('giá lẻ 200.000, trần 45%: "25.000" (gõ thay cho 125.000) và 109.999 bị chặn kèm lý do; 110.000 qua; cao hơn giá lẻ bị chặn', async () => {
    const run = async (input: string) =>
      (await classifyDealerPrices(db(200_000), 't1', parseDealerPriceCsv(`A1,${input}`), { maxDiscount: 0.45 })).rows[0]!;
    const low = await run('25.000');
    expect(low.status).toBe('OUT_OF_RANGE');
    expect(low.message).toContain('thấp hơn sàn 110.000đ');
    expect(low.message).toContain('dealer.max_discount_pct');
    expect((await run('109.999')).status).toBe('OUT_OF_RANGE');
    expect((await run('110.000')).status).toBe('OK');
    const high = await run('200.001');
    expect(high.status).toBe('OUT_OF_RANGE');
    expect(high.message).toContain('cao hơn giá lẻ 200.000đ');
  });

  it('trần chiết khấu 95% → sàn vẫn không dưới 10% giá lẻ', async () => {
    const run = async (input: string) =>
      (await classifyDealerPrices(db(200_000), 't1', parseDealerPriceCsv(`A1,${input}`), { maxDiscount: 0.95 })).rows[0]!.status;
    expect(await run('20.000')).toBe('OK');
    expect(await run('19.999')).toBe('OUT_OF_RANGE');
  });
});

describe('parseDealerPriceCsv — ô có ngoặc kép (Excel/Google Sheets xuất CSV)', () => {
  it('"A2",185000 / "A3","185,000" / A4;"185.000" / tiêu đề trong ngoặc → SKU không dính dấu ngoặc, giá đúng', () => {
    const rows = parseDealerPriceCsv('"SKU","Giá sỉ"\n"A2",185000\n"A3","185,000"\nA4;"185.000"\n"A ""5""",90000');
    expect(rows.map((r) => [r.line, r.sku, r.price, r.problem])).toEqual([
      [2, 'A2', 185_000, null],
      [3, 'A3', 185_000, null],
      [4, 'A4', 185_000, null],
      [5, 'A "5"', 90_000, null],
    ]);
  });
});
