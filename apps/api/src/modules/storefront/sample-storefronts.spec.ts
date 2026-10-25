import { readFileSync } from 'fs';
import path from 'path';
import { ALLOWED_DB_NAMES, ALLOW_DB_FLAG_PREFIX, describeDatabaseTarget, assertSampleSeedAllowed, effectiveDatabaseUrl, PROD_FLAG, SAMPLE_STOREFRONTS, SampleSeedRefusal } from './sample-storefronts';
import { normalizeSubdomain } from './identifier-validation';

const local = 'postgresql://tubu@127.0.0.1:35880/tubutree_it?schema=public';

describe('assertSampleSeedAllowed', () => {
  const run = (databaseUrl: string | undefined, env: NodeJS.ProcessEnv = {}, argv: string[] = []) => () => assertSampleSeedAllowed({ env, databaseUrl, argv });

  it('cho chạy khi DATABASE_URL trỏ 127.0.0.1 hoặc localhost và không phải production', () => {
    expect(run(local)).not.toThrow();
    expect(run('postgresql://u:p@localhost:5434/tubutree_dev')).not.toThrow();
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

  it.each([
    ['tham số host= trỏ máy chủ lạ', 'postgresql://u:p@127.0.0.1:5432/tubutree?host=db.prod.example'],
    ['tham số hostaddr=', 'postgresql://u:p@localhost/tubutree?hostaddr=10.0.0.5'],
    ['tên miền bắt đầu bằng localhost', 'postgresql://u:p@localhost.evil.com/tubutree'],
    ['nip.io trỏ về 127.0.0.1 giả', 'postgresql://u:p@127.0.0.1.nip.io/tubutree'],
    ['socket unix, không có tên máy', 'postgresql:///tubutree?host=/var/run/postgresql'],
    ['socket không tham số', 'postgresql:///tubutree'],
    ['tên DB không nằm trong danh sách', 'postgresql://u:p@127.0.0.1:5432/tubutree_prod'],
    ['không có tên DB', 'postgresql://u:p@127.0.0.1:5432'],
  ])('từ chối: %s', (_name, url) => {
    expect(run(url)).toThrow(SampleSeedRefusal);
  });

  it('cho chạy với [::1] và mọi tên DB máy thử trong danh sách', () => {
    expect(run('postgresql://u:p@[::1]:5432/tubutree_it')).not.toThrow();
    for (const db of ALLOWED_DB_NAMES) expect(run(`postgresql://u:p@127.0.0.1:5432/${db}?schema=public`)).not.toThrow();
    expect([...ALLOWED_DB_NAMES].sort()).toEqual(['tubutree_dev', 'tubutree_it', 'tubutree_uat_tpl']);
  });

  it('NODE_ENV rỗng hoặc test vẫn bị chặn bởi URL; NODE_ENV=production chặn cả URL tốt', () => {
    expect(run(local, { NODE_ENV: '' })).not.toThrow();
    expect(run('postgresql://u:p@db.example.com/tubutree', { NODE_ENV: '' })).toThrow(SampleSeedRefusal);
    expect(run(local, { NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });

  it('DB tên tubutree (trùng tên PROD, kể cả qua tunnel về localhost) bị chặn nếu không có --allow-db=tubutree', () => {
    const url = 'postgresql://u:p@localhost:5434/tubutree';
    expect(run(url)).toThrow(SampleSeedRefusal);
    expect(run(url)).toThrow(/--allow-db=tubutree/);
    expect(run(url, {}, [`${ALLOW_DB_FLAG_PREFIX}tubutree`])).not.toThrow();
  });

  it('--allow-db chỉ mở đúng tên DB đã ghi và vẫn bắt buộc máy chủ là localhost', () => {
    expect(run('postgresql://u:p@localhost/khac', {}, [`${ALLOW_DB_FLAG_PREFIX}tubutree`])).toThrow(SampleSeedRefusal);
    expect(run('postgresql://u:p@db.example.com/tubutree', {}, [`${ALLOW_DB_FLAG_PREFIX}tubutree`])).toThrow(/db\.example\.com/);
    expect(run('postgresql://u:p@localhost/tubutree', { NODE_ENV: 'production' }, [`${ALLOW_DB_FLAG_PREFIX}tubutree`])).toThrow(/NODE_ENV=production/);
  });

  it('describeDatabaseTarget in máy chủ:cổng/DB, không lộ mật khẩu', () => {
    expect(describeDatabaseTarget('postgresql://tubu:matkhau@127.0.0.1:5434/tubutree?schema=public')).toBe('127.0.0.1:5434/tubutree');
    expect(describeDatabaseTarget(undefined)).toContain('không đọc được');
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
