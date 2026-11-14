import { describe, expect, it } from 'vitest';
import type { CatalogAuditProductDto } from '@tubutree/shared-types';
import { buildPancakeFixCsv, PANCAKE_FIX_CSV_HEADERS, pancakeFixCsvFilename } from './catalog-pancake-csv';
import { auditCatalogProducts, auditProductDtos, type AuditProduct, type AuditVariation } from './catalog-quality-audit';

const V = (over: Partial<AuditVariation> = {}): AuditVariation => ({
  id: 'v1',
  pancakeId: 'pk-v1',
  sku: 'SKU-1',
  name: 'Chai 100ml',
  stock: 10,
  retailPrice: 50000,
  isActive: true,
  ...over,
});
const P = (variations: AuditVariation[], over: Partial<AuditProduct> = {}): AuditProduct => ({
  slug: 'sp-a',
  name: 'Sản phẩm A',
  thumbnail: 'https://x/ok.png',
  description: 'ok',
  inStock: true,
  variations,
  ...over,
});
const csv = (products: AuditProduct[]) => buildPancakeFixCsv(auditCatalogProducts(products), products);
const HEADER = 'pancakeId,sku,name,issueCodes,currentStock,retailPrice';
const BOM = '﻿';
/** Bỏ BOM, tách dòng theo CRLF: dòng 0 là tiêu đề. */
const lines = (text: string) => text.slice(1).split('\r\n');

describe('buildPancakeFixCsv', () => {
  it('bắt đầu bằng BOM UTF-8, đúng một BOM, tiêu đề đúng tên và thứ tự cột', () => {
    const out = csv([P([V({ retailPrice: 0 })])]);
    expect(out.startsWith(`${BOM}${HEADER}\r\n`)).toBe(true);
    expect(out.indexOf(BOM, 1)).toBe(-1);
    expect(PANCAKE_FIX_CSV_HEADERS.join(',')).toBe(HEADER);
  });

  it('không có biến thể lỗi: chỉ BOM và tiêu đề, không dòng nào, không xuống dòng thừa', () => {
    expect(csv([P([V()])])).toBe(`${BOM}${HEADER}`);
    expect(csv([])).toBe(`${BOM}${HEADER}`);
    expect(buildPancakeFixCsv({ summary: auditCatalogProducts([]).summary, rows: [] }, [])).toBe(`${BOM}${HEADER}`);
  });

  it('dòng cách nhau bằng CRLF (không có LF trần), một dòng mỗi biến thể', () => {
    const out = csv([P([V({ id: 'a', sku: 'A', retailPrice: 0 }), V({ id: 'b', sku: 'B', stock: 100000 }), V({ id: 'c', sku: 'C' })])]);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(out)).toEqual([HEADER, 'pk-v1,A,Chai 100ml,invalid_retail_price,10,0', 'pk-v1,B,Chai 100ml,placeholder_stock,100000,50000']);
  });

  it('chỉ biến thể bị gắn lỗi cấp biến thể; sản phẩm chỉ lỗi ảnh/mô tả không có dòng', () => {
    const out = csv([
      P([V({ id: 'a', sku: 'A' })], { slug: 'chi-thieu-anh', thumbnail: null, description: '' }),
      P([V({ id: 'b', sku: 'OK' }), V({ id: 'c', sku: 'BAD', retailPrice: -1 })], { slug: 'co-loi-bien-the', thumbnail: null }),
    ]);
    expect(lines(out)).toEqual([HEADER, 'pk-v1,BAD,Chai 100ml,invalid_retail_price,10,-1']);
  });

  it('một biến thể nhiều lỗi: mã nối bằng "|" theo thứ tự nặng đến nhẹ', () => {
    const out = csv([P([V({ sku: 'X', name: '', stock: 999999, retailPrice: 0 })])]);
    expect(lines(out)[1]).toBe('pk-v1,X,Sản phẩm A,invalid_retail_price|placeholder_stock|unnamed_variation,999999,0');
    const two = csv([P([V({ sku: 'Y', name: '', stock: 100000 })])]);
    expect(lines(two)[1]).toContain(',placeholder_stock|unnamed_variation,');
  });

  it('name: tên biến thể nếu có; trống hoặc chỉ còn "[object Object]" thì dùng tên sản phẩm; dính giữa tên thì giữ phần tên thật đã gỡ chuỗi hỏng (vẫn báo unnamed_variation)', () => {
    const out = csv([
      P([V({ id: 'a', sku: 'A', name: 'Chai 500ml', retailPrice: 0 }), V({ id: 'b', sku: 'B', name: '  ' }), V({ id: 'c', sku: 'C', name: '[object Object]' }), V({ id: 'd', sku: 'D', name: 'Hộp [object Object] 100g' })]),
    ]);
    const rows = lines(out).slice(1);
    expect(rows[0]).toContain(',A,Chai 500ml,');
    expect(rows[1]).toContain(',B,Sản phẩm A,unnamed_variation,');
    expect(rows[2]).toContain(',C,Sản phẩm A,unnamed_variation,');
    expect(rows[3]).toContain(',D,Hộp 100g,unnamed_variation,');
  });

  it('pancakeId null thì để ô rỗng; số xuất thô (không dấu chấm nghìn, không đơn vị)', () => {
    const out = csv([P([V({ pancakeId: null, sku: 'N', stock: 1234567, retailPrice: 0 })])]);
    expect(lines(out)[1]).toBe(',N,Chai 100ml,invalid_retail_price|placeholder_stock,1234567,0');
  });

  it('giá không phải số hữu hạn xuất thô dạng chữ', () => {
    const out = csv([P([V({ sku: 'NAN', retailPrice: Number.NaN })])]);
    expect(lines(out)[1]).toBe('pk-v1,NAN,Chai 100ml,invalid_retail_price,10,NaN');
  });

  it('bao gồm biến thể đang ẩn và sản phẩm đang ẩn', () => {
    const out = csv([P([V({ sku: 'HIDDEN', isActive: false, retailPrice: 0 })], { isActive: false, inStock: false })]);
    expect(lines(out)).toEqual([HEADER, 'pk-v1,HIDDEN,Chai 100ml,invalid_retail_price,10,0']);
  });

  describe('thoát ô CSV', () => {
    const rowFor = (over: Partial<AuditVariation>, product: Partial<AuditProduct> = {}) => csv([P([V({ retailPrice: 0, ...over })], product)]);

    it('ô có dấu phẩy được bọc nháy kép', () => {
      expect(lines(rowFor({ name: 'Chai, 100ml' }))[1]).toBe('pk-v1,SKU-1,"Chai, 100ml",invalid_retail_price,10,0');
    });

    it('nháy kép trong ô được nhân đôi', () => {
      expect(lines(rowFor({ name: 'Chai "xịt" 100ml' }))[1]).toBe('pk-v1,SKU-1,"Chai ""xịt"" 100ml",invalid_retail_price,10,0');
    });

    it('xuống dòng trong ô giữ nguyên bên trong nháy kép, không tách thành dòng mới của bảng', () => {
      const out = rowFor({ name: 'Dòng 1\nDòng 2' });
      expect(out).toContain('"Dòng 1\nDòng 2"');
      expect(out.split('\r\n')).toHaveLength(2);
      expect(rowFor({ name: 'A\r\nB' })).toContain('"A\r\nB"');
    });

    it.each([
      ['=cmd', "'=cmd"],
      ['+1', "'+1"],
      ['-1', "'-1"],
      ['@x', "'@x"],
    ])('ô chữ mở đầu bằng công thức %s được thêm dấu nháy đơn', (name, expected) => {
      expect(lines(rowFor({ name }))[1]).toBe(`pk-v1,SKU-1,${expected},invalid_retail_price,10,0`);
    });

    it('chống công thức cả ở sku và pancakeId; ký tự tab đầu ô cũng bị chặn', () => {
      expect(lines(rowFor({ sku: '=HYPERLINK("http://x")', pancakeId: '+cmd' }))[1]).toBe(`'+cmd,"'=HYPERLINK(""http://x"")",Chai 100ml,invalid_retail_price,10,0`);
      expect(lines(rowFor({ name: '\tx' }))[1]).toContain(",'\tx,");
    });

    it('chống công thức chạy trước khi bọc dấu phẩy: "=a,b" thành "\'=a,b" trong nháy kép', () => {
      expect(lines(rowFor({ name: '=a,b' }))[1]).toContain(`,"'=a,b",`);
    });

    it('tên sản phẩm dùng thay tên biến thể cũng được thoát', () => {
      expect(lines(csv([P([V({ name: '' })], { name: '=evil, "SP"' })]))[1]).toBe(`pk-v1,SKU-1,"'=evil, ""SP""",unnamed_variation,10,50000`);
    });

    it('số âm hữu hạn ở cột số không bị thêm dấu nháy (giá -1 vẫn là số)', () => {
      expect(lines(rowFor({ retailPrice: -1 }))[1]).toBe('pk-v1,SKU-1,Chai 100ml,invalid_retail_price,10,-1');
    });
  });

  describe('ghép dòng với sản phẩm', () => {
    it('thứ tự dòng theo kết quả kiểm (còn hàng trước), trong một sản phẩm theo thứ tự biến thể', () => {
      const out = csv([
        P([V({ id: 'h', sku: 'HET', retailPrice: 0 })], { slug: 'het', name: 'Hết', inStock: false }),
        P([V({ id: 'c2', sku: 'C2', retailPrice: 0 }), V({ id: 'c1', sku: 'C1', retailPrice: 0 })], { slug: 'con', name: 'Còn' }),
      ]);
      expect(lines(out).slice(1).map((l) => l.split(',')[1])).toEqual(['C2', 'C1', 'HET']);
    });

    it('sản phẩm có trong kết quả nhưng thiếu trong danh sách truyền vào thì bỏ qua, không ném lỗi', () => {
      const products = [P([V({ retailPrice: 0 })])];
      expect(buildPancakeFixCsv(auditCatalogProducts(products), [])).toBe(`${BOM}${HEADER}`);
    });

    it('nhận trực tiếp DTO máy chủ', () => {
      const dto: CatalogAuditProductDto = {
        id: 'p1',
        slug: 'sp-dto',
        name: 'SP DTO',
        pancakeId: 'pk-p1',
        isActive: false,
        thumbnail: 'https://x/ok.png',
        description: 'ok',
        shortDesc: null,
        hasIngredients: true,
        inStock: false,
        variations: [V({ sku: 'D1', retailPrice: 0, isActive: false })],
      };
      expect(lines(buildPancakeFixCsv(auditProductDtos([dto]), [dto]))).toEqual([HEADER, 'pk-v1,D1,Chai 100ml,invalid_retail_price,10,0']);
    });
  });
});

describe('pancakeFixCsvFilename', () => {
  it('đúng dạng tubutree-sua-pancake-YYYYMMDD.csv', () => {
    expect(pancakeFixCsvFilename(new Date('2026-11-12T05:00:00Z'))).toBe('tubutree-sua-pancake-20261112.csv');
  });

  it('theo ngày Việt Nam (UTC+7): 17:30 UTC ngày 11 đã là ngày 12 ở Việt Nam; 16:59 UTC vẫn là ngày 11', () => {
    expect(pancakeFixCsvFilename(new Date('2026-11-11T17:30:00Z'))).toBe('tubutree-sua-pancake-20261112.csv');
    expect(pancakeFixCsvFilename(new Date('2026-11-11T16:59:59Z'))).toBe('tubutree-sua-pancake-20261111.csv');
  });

  it('qua ranh giới năm', () => {
    expect(pancakeFixCsvFilename(new Date('2026-12-31T18:00:00Z'))).toBe('tubutree-sua-pancake-20270101.csv');
  });

  it('không truyền ngày thì dùng hôm nay và vẫn đúng dạng', () => {
    expect(pancakeFixCsvFilename()).toMatch(/^tubutree-sua-pancake-\d{8}\.csv$/);
  });
});
