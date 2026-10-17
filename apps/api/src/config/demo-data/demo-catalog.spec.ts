import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_BRANDS,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_MIGRATION,
  DEMO_PRODUCTS,
  DEMO_PRODUCTS_LOADED_AT,
  DEMO_VARIATIONS,
  classifyDemoCoupon,
  isDemoCouponKind,
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

  it('DEMO_PRODUCTS_LOADED_AT: sau mọi updatedAt migration ghi cho sản phẩm demo, cách cái muộn nhất dưới 1 giây', () => {
    const lines = sql.split('\n');
    const stamps = lines
      .filter((_, i) => lines[i - 1]?.startsWith('INSERT INTO products '))
      .map((l) => [...l.matchAll(/'(2026-[0-9T:.-]+Z)'/g)].map((m) => new Date(m[1]!).getTime()).at(-1)!);
    expect(stamps).toHaveLength(44);
    const latest = Math.max(...stamps);
    expect(DEMO_PRODUCTS_LOADED_AT.getTime()).toBeGreaterThan(latest);
    expect(DEMO_PRODUCTS_LOADED_AT.getTime() - latest).toBeLessThan(1000);
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

  it('mã giảm giá: id, code và điều kiện', () => {
    const lines = sql.split('\n');
    const fromSql = lines
      .map((l, i) => (lines[i - 1]?.startsWith('INSERT INTO coupons ') ? l : null))
      .filter((l): l is string => l !== null)
      .map((l) => {
        // Cột: id, code, type, value, minOrder, maxDiscount, startAt, endAt, usageLimit, perUserLimit, applyTo, isStackable, scope, scopeMeta
        const v = l.replace(/^SELECT /, '').split(', ').map((x) => (x === 'NULL' ? null : x.replace(/^'(.*)'$/, '$1')));
        const n = (x: string | null | undefined) => (x == null ? null : Number(x));
        return {
          id: v[0],
          code: v[1],
          terms: { type: v[2], value: n(v[3]), minOrder: n(v[4]), maxDiscount: n(v[5]), perUserLimit: n(v[9]), scope: v[12] },
        };
      });
    expect(DEMO_COUPONS).toEqual(fromSql);
  });

  it('mã giảm giá: prisma/seed.ts tạo cùng mã với đúng điều kiện đó (nếu seed đổi, phân loại "seed" phải đổi theo)', () => {
    const seed = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf8');
    for (const c of DEMO_COUPONS) {
      const line = seed.split('\n').find((l) => l.includes(`code: '${c.code}'`) && l.includes('scope:'));
      expect(line).toBeDefined();
      const num = (k: string) => {
        const m = new RegExp(`\\b${k}: (\\d+)`).exec(line!);
        return m ? Number(m[1]) : null;
      };
      expect({
        type: /type: '(\w+)'/.exec(line!)?.[1],
        value: num('value'),
        minOrder: num('minOrder'),
        maxDiscount: num('maxDiscount'),
        perUserLimit: num('perUserLimit'),
        scope: /scope: '(\w+)'/.exec(line!)?.[1],
      }).toEqual(c.terms);
    }
  });

  it('classifyDemoCoupon: id migration, hoặc mã + điều kiện khớp (seed) là demo; chỉ trùng tên là mã thật', () => {
    const w = DEMO_COUPONS[0]!;
    const row = { id: 'cuid-from-seed', code: w.code, ...w.terms };
    expect(classifyDemoCoupon({ ...row, id: w.id, value: 99 })).toBe('migration');
    expect(classifyDemoCoupon(row)).toBe('seed');
    expect(classifyDemoCoupon({ ...row, value: 50000 })).toBe('name-only');
    expect(classifyDemoCoupon({ ...row, maxDiscount: 10000 })).toBe('name-only');
    expect(classifyDemoCoupon({ ...row, scope: 'TIER' })).toBe('name-only');
    expect(classifyDemoCoupon({ ...row, code: 'TET2027' })).toBeNull();
    expect(isDemoCouponKind('seed') && isDemoCouponKind('migration') && !isDemoCouponKind('name-only') && !isDemoCouponKind(null)).toBe(true);
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
