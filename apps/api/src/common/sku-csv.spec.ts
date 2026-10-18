import { splitSkuCsvLine } from './sku-csv';

describe('splitSkuCsvLine', () => {
  it.each([
    ['A1,10', ',', ['A1', '10']],
    ['A1;10', ';', ['A1', '10']],
    ['A1\t10', '\t', ['A1', '10']],
    ['"A1",10', ',', ['A1', '10']],
    ['"A1","185,000"', ',', ['A1', '185,000']],
    ['"A;1",10', ',', ['A;1', '10']],
    ['"A ""x""" , 10', ',', ['A "x"', '10']],
    ['A1,10,,', ',', ['A1', '10']],
    ['A"1,10', ',', ['A"1', '10']],
  ])('%s → %j', (line, delim, cells) => {
    expect(splitSkuCsvLine(line)).toEqual({ delim, cells });
  });

  it('ngoặc không đóng → cả phần sau là một ô (dòng lỗi "thiếu cột" thay vì SKU dính ngoặc)', () => {
    expect(splitSkuCsvLine('"A1,10').cells).toEqual(['A1,10']);
  });
});
