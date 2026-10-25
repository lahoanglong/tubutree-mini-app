import { readFileSync } from 'fs';
import path from 'path';
import { assertSampleSeedAllowed, effectiveDatabaseUrl, PROD_FLAG, SAMPLE_STOREFRONTS, SampleSeedRefusal } from './sample-storefronts';
import { normalizeSubdomain } from './identifier-validation';

const local = 'postgresql://tubu@127.0.0.1:35880/tubutree_it?schema=public';

describe('assertSampleSeedAllowed', () => {
  const run = (databaseUrl: string | undefined, env: NodeJS.ProcessEnv = {}, argv: string[] = []) => () => assertSampleSeedAllowed({ env, databaseUrl, argv });

  it('cho chạy khi DATABASE_URL trỏ 127.0.0.1 hoặc localhost và không phải production', () => {
    expect(run(local)).not.toThrow();
    expect(run('postgresql://u:p@localhost:5434/tubutree')).not.toThrow();
  });

  it('từ chối khi NODE_ENV=production dù DB là localhost', () => {
    expect(run(local, { NODE_ENV: 'production' })).toThrow(SampleSeedRefusal);
  });

  it('từ chối khi DATABASE_URL không phải localhost, thiếu hoặc hỏng', () => {
    expect(run('postgresql://u:p@db.example.com:5432/tubutree')).toThrow(/db\.example\.com/);
    expect(run('postgresql://u:p@127.0.0.1.evil.com/tubutree')).toThrow(SampleSeedRefusal);
    expect(run(undefined)).toThrow(/DATABASE_URL/);
    expect(run('không phải url')).toThrow(SampleSeedRefusal);
  });

  it('chỉ cờ --i-know-this-is-prod mới vượt được', () => {
    expect(run('postgresql://u:p@db.example.com/tubutree', { NODE_ENV: 'production' }, [PROD_FLAG])).not.toThrow();
    expect(run('postgresql://u:p@db.example.com/tubutree', { NODE_ENV: 'production', ALLOW_PROD_SEED: '1' })).toThrow(SampleSeedRefusal);
  });
});

describe('effectiveDatabaseUrl', () => {
  it('ưu tiên biến môi trường, rồi dòng trong .env', () => {
    expect(effectiveDatabaseUrl({ DATABASE_URL: 'a' }, 'DATABASE_URL="b"')).toBe('a');
    expect(effectiveDatabaseUrl({}, 'PORT=1\nDATABASE_URL="postgresql://x@127.0.0.1/db"\n')).toBe('postgresql://x@127.0.0.1/db');
    expect(effectiveDatabaseUrl({}, null)).toBeUndefined();
  });
});

describe('SAMPLE_STOREFRONTS', () => {
  const seedSource = readFileSync(path.resolve(__dirname, '../../../prisma/seed.ts'), 'utf-8');

  it('có 3 gian hàng khác kiểu, slug khác nhau và hợp lệ', () => {
    expect(SAMPLE_STOREFRONTS).toHaveLength(3);
    expect(new Set(SAMPLE_STOREFRONTS.map((s) => s.slug)).size).toBe(3);
    expect(new Set(SAMPLE_STOREFRONTS.map((s) => `${s.type}:${s.ownerRole}`)).size).toBeGreaterThanOrEqual(2);
    for (const s of SAMPLE_STOREFRONTS) expect(() => normalizeSubdomain(s.slug)).not.toThrow();
  });

  it('chỉ dùng sản phẩm có trong seed máy thử', () => {
    for (const s of SAMPLE_STOREFRONTS) {
      for (const c of s.collections) {
        expect(c.items.length).toBeGreaterThan(0);
        for (const i of c.items) expect(seedSource).toContain(`slug: '${i.productSlug}'`);
      }
    }
  });

  it('mỗi sản phẩm xuất hiện một lần trong một gian hàng', () => {
    for (const s of SAMPLE_STOREFRONTS) {
      const slugs = s.collections.flatMap((c) => c.items.map((i) => i.productSlug));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
