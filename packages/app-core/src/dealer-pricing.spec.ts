import { describe, expect, it } from 'vitest';
import {
  csvTextCell,
  DEALER_MAX_QTY,
  DEALER_QUOTE_MAX_LINES,
  dealerBrands,
  dealerPricelistCsv,
  dealerPricelistFileName,
  dealerQuoteText,
  filterDealerPricelist,
  preorderQty,
  realDiscountPct,
} from './dealer-pricing';

describe('dealer-pricing', () => {
  it('preorderQty: chỉ tính phần vượt tồn, tồn âm coi như 0', () => {
    expect(preorderQty(3, 5)).toBe(0);
    expect(preorderQty(5, 5)).toBe(0);
    expect(preorderQty(8, 5)).toBe(3);
    expect(preorderQty(2, 0)).toBe(2);
    expect(preorderQty(2, -4)).toBe(2);
  });

  it('realDiscountPct: tính từ giá thật, làm tròn, không âm', () => {
    expect(realDiscountPct(100_000, 70_000)).toBe(30);
    expect(realDiscountPct(100_000, 80_000)).toBe(20);
    expect(realDiscountPct(3, 2)).toBe(33);
    expect(realDiscountPct(100_000, 100_000)).toBe(0);
    expect(realDiscountPct(100_000, 120_000)).toBe(0);
  });

  it('realDiscountPct: giá lẻ không hợp lệ thì 0, không NaN', () => {
    expect(realDiscountPct(0, 0)).toBe(0);
    expect(realDiscountPct(-5, 1)).toBe(0);
    expect(realDiscountPct(Number.NaN, 1)).toBe(0);
  });

  it('trần số lượng là số hợp lý, không phải tồn kho', () => {
    expect(DEALER_MAX_QTY).toBe(9999);
  });
});

const row = (o: Partial<Parameters<typeof dealerPricelistCsv>[0][number]> = {}) => ({
  sku: 'FUWA-DW-500',
  product: 'Nước rửa chén Fuwa',
  brand: 'Fuwa',
  variation: '500ml',
  retailPrice: 59_000,
  dealerPrice: 45_000,
  stock: 12,
  ...o,
});

describe('dealer-pricing: bộ lọc bảng giá', () => {
  const rows = [
    row(),
    row({ sku: 'POL-1', product: 'Sữa tắm Polang', brand: 'Polang', stock: 0 }),
    row({ sku: 'POL-2', product: 'Dầu gội', brand: ' polang ', stock: 3 }),
    row({ sku: 'X-1', product: 'Không thương hiệu', brand: '', stock: 1 }),
    row({ sku: 'AN-1', product: 'Ánh Dương', brand: 'Ánh Dương', stock: 5 }),
  ];

  it('dealerBrands: bỏ trống, gộp trùng không phân biệt hoa thường/khoảng trắng, sắp ABC tiếng Việt', () => {
    expect(dealerBrands(rows)).toEqual(['Ánh Dương', 'Fuwa', 'Polang']);
    expect(dealerBrands([])).toEqual([]);
  });

  it('lọc theo thương hiệu (không phân biệt hoa thường), còn hàng sẵn (stock > 0), từ khoá; ba điều kiện cộng dồn', () => {
    expect(filterDealerPricelist(rows, { brand: 'POLANG' }).map((r) => r.sku)).toEqual(['POL-1', 'POL-2']);
    expect(filterDealerPricelist(rows, { inStockOnly: true }).map((r) => r.sku)).toEqual(['FUWA-DW-500', 'POL-2', 'X-1', 'AN-1']);
    expect(filterDealerPricelist(rows, { brand: 'Polang', inStockOnly: true }).map((r) => r.sku)).toEqual(['POL-2']);
    expect(filterDealerPricelist(rows, { query: '  fuwa ' }).map((r) => r.sku)).toEqual(['FUWA-DW-500']);
    expect(filterDealerPricelist(rows, { query: 'pol-', brand: 'Polang', inStockOnly: true }).map((r) => r.sku)).toEqual(['POL-2']);
    expect(filterDealerPricelist(rows, { brand: '  ', query: '' })).toHaveLength(5);
    expect(filterDealerPricelist(rows, { brand: 'Không có' })).toEqual([]);
  });
});

describe('dealer-pricing: file CSV', () => {
  it('có BOM UTF-8, tiêu đề, CRLF, số nguyên trần, % giảm từ giá thật, tồn âm thành 0', () => {
    const csv = dealerPricelistCsv([row(), row({ sku: 'B', product: 'Hết hàng', stock: -2, retailPrice: 10_000, dealerPrice: 10_000 })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"SKU","Sản phẩm","Phân loại","Thương hiệu","Giá lẻ (đ)","Giá đại lý (đ)","Giảm (%)","Tồn kho"');
    expect(lines[1]).toBe('"FUWA-DW-500","Nước rửa chén Fuwa","500ml","Fuwa",59000,45000,24,12');
    expect(lines[2]).toBe('"B","Hết hàng","500ml","Fuwa",10000,10000,0,0');
    expect(lines[3]).toBe('');
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it('chống chèn công thức: ô chữ mở đầu bằng = + - @ tab CR được thêm nháy đơn; ngoặc kép bị nhân đôi; dấu phẩy và xuống dòng nằm trong ngoặc', () => {
    for (const evil of ['=HYPERLINK("http://x","bấm")', '+1+1', '-2+3', '@SUM(A1)', '\tTAB', '\rCR']) {
      expect(csvTextCell(evil).startsWith(`"'`)).toBe(true);
    }
    expect(csvTextCell('=1+"2"')).toBe(`"'=1+""2"""`);
    expect(csvTextCell('a, b\nc')).toBe('"a, b\nc"');
    expect(csvTextCell(null)).toBe('""');
    const csv = dealerPricelistCsv([row({ product: '=cmd|"/c calc"!A0', sku: '-SKU', brand: '@B' })]);
    expect(csv).toContain(`"'=cmd|""/c calc""!A0"`);
    expect(csv).toContain(`"'-SKU"`);
    expect(csv).toContain(`"'@B"`);
  });

  it('nhãn phân loại qua hàm của app; số không hữu hạn để trống', () => {
    const csv = dealerPricelistCsv([row({ variation: '[object Object]', retailPrice: Number.NaN })], () => null);
    expect(csv.split('\r\n')[1]).toBe('"FUWA-DW-500","Nước rửa chén Fuwa","","Fuwa",,45000,0,12');
    expect(dealerPricelistFileName('2026-11-23')).toBe('bang-gia-dai-ly-tubu-2026-11-23.csv');
  });
});

describe('dealer-pricing: báo giá chép nhanh', () => {
  const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

  it('một dòng mỗi mặt hàng: giá đại lý, giá lẻ, % giảm; hết hàng thì nói nhận đặt trước', () => {
    const text = dealerQuoteText([row(), row({ sku: 'P-1', product: 'Sữa tắm', variation: '', retailPrice: 30_000, dealerPrice: 30_000, stock: 0 })], {
      dateLabel: '23/11/2026',
      money,
    });
    expect(text.split('\n')).toEqual([
      'Báo giá đại lý Tubu Tree (23/11/2026)',
      '- Nước rửa chén Fuwa · 500ml (FUWA-DW-500): 45.000đ (giá lẻ 59.000đ, -24%)',
      '- Sữa tắm (P-1): 30.000đ · hết hàng, nhận đặt trước',
    ]);
  });

  it('quá trần dòng: dòng cuối báo còn bao nhiêu mặt hàng', () => {
    const many = Array.from({ length: DEALER_QUOTE_MAX_LINES + 4 }, (_, i) => row({ sku: `S${i}` }));
    const lines = dealerQuoteText(many, { dateLabel: 'x', money }).split('\n');
    expect(lines).toHaveLength(1 + DEALER_QUOTE_MAX_LINES + 1);
    expect(lines.at(-1)).toBe('… và 4 mặt hàng khác (tải file CSV để xem đủ).');
    expect(dealerQuoteText(many, { dateLabel: 'x', money, maxLines: 2 }).split('\n')).toHaveLength(4);
  });
});
