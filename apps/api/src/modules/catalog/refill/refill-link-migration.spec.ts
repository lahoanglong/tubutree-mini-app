import { readFileSync } from 'fs';
import { join } from 'path';
import { PROD_REFILL_CATALOG_2026_11_18 as PROD } from '../../../../../../packages/app-core/src/commerce/prod-refill.fixture';
import { isRefillProduct, pairRefills, refillFormulaKey, refillPairRows, type RefillCatalogRow, type RefillPairOverride } from './refill-pairs';

/**
 * Migration tubu-w9-03 ghép tay 12 cặp chai ↔ gói Refill 10L (PO quyết A5). Spec này đối chiếu danh sách slug ghi cứng trong SQL với luật
 * ghép trên ảnh chụp danh mục PROD 18/11/2026: đúng 12 dòng `size` (cùng thương hiệu, cùng tên công thức, đúng một gói), không thừa,
 * không thiếu. Hành vi SQL thật (chỉ cộng, không đè ghép tay, bỏ slug bị chặn, chạy lại không đổi) ở race spec
 * `test/integration-race/refill-link-size-pairs-migration.race-spec.ts`.
 */
const SQL = readFileSync(join(__dirname, '../../../../prisma/migrations/20261120083000_refill_link_twelve_size_pairs/migration.sql'), 'utf8');
const rows: RefillCatalogRow[] = PROD.map((p) => ({ id: p.slug, slug: p.slug, name: p.name, brand: p.brand }));
const bySlug = new Map(PROD.map((p) => [p.slug, p]));

function migrationPairs(): RefillPairOverride[] {
  const out: RefillPairOverride[] = [];
  for (const m of SQL.matchAll(/\(\s*\d+,\s*'([a-z0-9-]+)',\s*'([a-z0-9-]+)'\s*\)/g)) out.push({ bottleSlug: m[1]!, refillSlug: m[2]! });
  return out;
}

describe('migration 20261120083000_refill_link_twelve_size_pairs', () => {
  const pairs = migrationPairs();

  it('đúng 12 cặp, mỗi chai một lần', () => {
    expect(pairs).toHaveLength(12);
    expect(new Set(pairs.map((p) => p.bottleSlug)).size).toBe(12);
  });

  it('trùng khít 12 dòng "Gói lớn hơn 3 lần chai: chờ ghép tay" (size) của bảng cặp trên danh mục PROD', () => {
    const size = refillPairRows(rows).filter((r) => r.status === 'size');
    const key = (o: RefillPairOverride) => `${o.bottleSlug} -> ${o.refillSlug}`;
    expect(pairs.map(key).sort()).toEqual(size.map((r) => key({ bottleSlug: r.bottle.slug, refillSlug: r.refill!.slug })).sort());
    expect(size.every((r) => r.candidates === 1)).toBe(true);
  });

  it('mỗi cặp: cùng thương hiệu, cùng tên công thức, chai không phải refill, gói là refill, gói lớn hơn chai', () => {
    for (const p of pairs) {
      const bottle = bySlug.get(p.bottleSlug)!;
      const refill = bySlug.get(p.refillSlug)!;
      expect(bottle.brand).toBe(refill.brand);
      expect(refillFormulaKey(bottle.name)).toBe(refillFormulaKey(refill.name));
      expect(isRefillProduct(bottle)).toBe(false);
      expect(isRefillProduct(refill)).toBe(true);
      expect(refill.slug.startsWith('refill-')).toBe(true);
    }
  });

  it('áp xong: 16 chai có gói Refill (4 tự ghép + 12 ghép tay), không còn dòng size; 7 dòng near vẫn chờ admin', () => {
    const after = refillPairRows(rows, { overrides: pairs });
    const count = (s: string) => after.filter((r) => r.status === s).length;
    expect(count('auto')).toBe(4);
    expect(count('manual')).toBe(12);
    expect(count('size')).toBe(0);
    expect(count('near')).toBe(7);
    expect(pairRefills(rows, { overrides: pairs }).size).toBe(16);
  });

  it('chốt an toàn có mặt trong SQL: chỉ cộng, không đè ghép tay, bỏ slug bị chặn, lịch sử id cố định, không đụng cờ', () => {
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM existing x WHERE x\.bottle_slug = w\."bottleSlug" OR x\.refill_slug = w\."bottleSlug"\)/);
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM existing x WHERE x\.bottle_slug = w\."refillSlug"\)/);
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM blocked k WHERE/);
    expect(SQL).toMatch(/cfg\.old_value \|\| \(/);
    expect(SQL).toMatch(/ON CONFLICT \("id"\) DO NOTHING;\s*$/);
    const code = SQL.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|refill_first_enabled/i);
  });
});
