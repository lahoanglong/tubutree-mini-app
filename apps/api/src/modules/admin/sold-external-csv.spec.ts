import { BadRequestException } from '@nestjs/common';
import { parseSoldExternalCsv, soldExternalRowsOrThrow } from './sold-external-csv';

describe('parseSoldExternalCsv — "đã bán ngoài sàn" đọc số chặt', () => {
  it('số nhóm nghìn kiểu Excel đọc đủ: 1.250 / 1,250 (ô tách) / 1 250 → 1250, không phải 1', () => {
    expect(parseSoldExternalCsv('A1,1250\nA2;1.250\nA3\t1 250\nA4,1,250').map((r) => [r.sku, r.count, r.problem])).toEqual([
      ['A1', 1250, null],
      ['A2', 1250, null],
      ['A3', 1250, null],
      ['A4', 1250, null],
    ]);
  });

  it('0 hợp lệ (đặt lại về 0); dòng tiêu đề bị bỏ', () => {
    expect(parseSoldExternalCsv('SKU,Đã bán\nA1,0').map((r) => [r.line, r.sku, r.count, r.problem])).toEqual([[2, 'A1', 0, null]]);
  });

  it.each([
    ['A1,1.25', 'số đã bán không đọc được'],
    ['A1;12,5', 'số đã bán không đọc được'],
    ['A1,-3', 'số đã bán không đọc được'],
    ['A1,abc', 'số đã bán không đọc được'],
    ['A1', 'thiếu cột số đã bán'],
    [',100', 'thiếu SKU'],
    ['A1;100;7', 'thừa cột'],
  ])('%s → lỗi dòng (%s)', (line, problem) => {
    const [row] = parseSoldExternalCsv(line);
    expect(row).toMatchObject({ count: null });
    expect(row!.problem).toContain(problem);
  });
});

describe('soldExternalRowsOrThrow', () => {
  it('mọi dòng đọc được → trả {sku,count}', () => {
    expect(soldExternalRowsOrThrow('A1,1.250\nA2,0')).toEqual([
      { sku: 'A1', count: 1250 },
      { sku: 'A2', count: 0 },
    ]);
  });

  it('còn dòng lỗi → 400 nêu số dòng, không trả dòng nào để ghi', () => {
    let err: unknown;
    try {
      soldExternalRowsOrThrow('A1,100\nA2,1.25');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toContain('dòng 2');
    expect((err as BadRequestException).message).toContain('Chưa ghi dòng nào');
  });
});
