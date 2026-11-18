import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SEARCH_SYNONYM_SEED } from './search-synonyms.seed';
import { foldVietnamese } from './search-text';

const MIGRATIONS = join(__dirname, '../../../prisma/migrations');
const FIXTURE = join(__dirname, '../../../../../packages/app-core/src/commerce/prod-catalog-full.fixture.ts');

describe('Từ đồng nghĩa nạp sẵn', () => {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith('_search_fuzzy_popular'))!;
  const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
  const names = [...readFileSync(FIXTURE, 'utf8').matchAll(/name: '((?:[^'\\]|\\.)*)'/g)].map((m) => foldVietnamese(m[1]!));

  it('migration chứa đúng từng dòng của SEARCH_SYNONYM_SEED, ON CONFLICT DO NOTHING', () => {
    expect(SEARCH_SYNONYM_SEED.length).toBeGreaterThanOrEqual(40);
    for (const [term, canonical] of SEARCH_SYNONYM_SEED) expect(sql).toContain(`'${term}', '${canonical}', true`);
    expect(sql).toContain('ON CONFLICT ("term") DO NOTHING');
    expect(sql).not.toMatch(/\b(DROP|ALTER TABLE|DELETE|UPDATE)\b/);
  });

  it('hai vế đã gấp dấu, khác nhau, term không trùng', () => {
    const terms = SEARCH_SYNONYM_SEED.map(([t]) => t);
    expect(new Set(terms).size).toBe(terms.length);
    for (const [t, c] of SEARCH_SYNONYM_SEED) {
      expect(foldVietnamese(t)).toBe(t);
      expect(foldVietnamese(c)).toBe(c);
      expect(t).not.toBe(c);
    }
  });

  it('mỗi vế thay thế ra ít nhất một món của catalog PROD 12/11 (mọi từ đều có trong một tên)', () => {
    expect(names.length).toBe(111);
    for (const [, canonical] of SEARCH_SYNONYM_SEED) {
      const words = canonical.split(' ');
      expect({ canonical, hit: names.some((n) => words.every((w) => n.includes(w))) }).toEqual({ canonical, hit: true });
    }
  });
});
