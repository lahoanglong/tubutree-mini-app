import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_BRANDS,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_MIGRATION,
  DEMO_PRODUCTS,
  DEMO_VARIATIONS,
} from './demo-catalog';

const sql = readFileSync(join(__dirname, '../../../prisma/migrations', DEMO_MIGRATION, 'migration.sql'), 'utf8');

/** Dòng `SELECT '<a>', '<b>', ...` ngay sau `INSERT INTO <table>`: các giá trị chuỗi đầu tiên theo thứ tự cột. */
function selectRows(table: string): string[][] {
  const rows: string[][] = [];
  const lines = sql.split('\n');
  lines.forEach((line, i) => {
    if (!line.startsWith(`INSERT INTO ${table} `)) return;
    const values = [...(lines[i + 1] ?? '').matchAll(/(NULL|'(?:[^']|'')*')/g)].map((m) => m[1]!);
    rows.push(values.map((v) => (v === 'NULL' ? '' : v.slice(1, -1))));
  });
  return rows;
}

describe('Danh sách dữ liệu demo khớp đúng file migration', () => {
  it('đếm đúng như chú thích của migration: 7 danh mục, 44 sản phẩm, 48 biến thể, 3 mã', () => {
    expect(sql).toContain('-- categories: 7 dòng');
    expect(sql).toContain('-- products: 44 dòng');
    expect(sql).toContain('-- variations: 48 dòng');
    expect(sql).toContain('-- coupons: 3 dòng');
    expect([DEMO_CATEGORIES.length, DEMO_PRODUCTS.length, DEMO_VARIATIONS.length, DEMO_COUPONS.length]).toEqual([7, 44, 48, 3]);
  });

  it('sản phẩm: id, pancakeId, slug', () => {
    // Cột: id, pancakeId, brand, slug, ...
    const fromSql = selectRows('products').map(([id, pancakeId, , slug]) => ({ id, pancakeId, slug }));
    expect(DEMO_PRODUCTS).toEqual(fromSql);
  });

  it('biến thể: id, pancakeId, productId, sku', () => {
    const fromSql = selectRows('variations').map(([id, pancakeId, productId, sku]) => ({ id, pancakeId, productId, sku }));
    expect(DEMO_VARIATIONS).toEqual(fromSql);
  });

  it('danh mục: id, slug', () => {
    // Cột: id, parentId (NULL), name, slug
    const fromSql = selectRows('categories').map(([id, , , slug]) => ({ id, slug }));
    expect(DEMO_CATEGORIES).toEqual(fromSql);
  });

  it('mã giảm giá: id, code', () => {
    const fromSql = selectRows('coupons').map(([id, code]) => ({ id, code }));
    expect(DEMO_COUPONS).toEqual(fromSql);
  });

  it('nhãn hàng: id = md5(tên nhãn) như migration brand_backfill, đủ mọi tên nhãn của sản phẩm demo', () => {
    const names = [...new Set(selectRows('products').map((r) => r[2]!))].sort();
    expect(DEMO_BRANDS.map((b) => b.name).sort()).toEqual(names);
    for (const b of DEMO_BRANDS) expect(b.id).toBe(createHash('md5').update(b.name).digest('hex'));
  });

  it('mọi biến thể thuộc một sản phẩm demo, pancakeId không trùng nhau', () => {
    const productIds = new Set(DEMO_PRODUCTS.map((p) => p.id));
    for (const v of DEMO_VARIATIONS) expect(productIds.has(v.productId)).toBe(true);
    const all = [...DEMO_PRODUCTS, ...DEMO_VARIATIONS].map((r) => r.pancakeId);
    expect(new Set(all).size).toBe(all.length);
  });
});
