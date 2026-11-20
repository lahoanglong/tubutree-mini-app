import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn } from './sql-script';

/**
 * tubu-w9-03: migration ghép tay 12 cặp chai ↔ gói Refill 10L. Chạy CHÍNH file migration.sql trên schema nháp (bảng dựng bằng LIKE bảng
 * public) để chứng minh: chỉ cộng vào cuối mảng, không đè cặp admin đã ghép, bỏ slug bị chặn, không tạo vòng, thiếu sản phẩm thì bỏ cặp,
 * chạy lại không đổi gì và không ghi thêm lịch sử.
 */
const SCHEMA = 'refill_link_w903';
const MIGRATION = readApiSql('prisma/migrations/20261120083000_refill_link_twelve_size_pairs/migration.sql');
const OVERRIDE = 'catalog.refill_pairs_override';
const BLOCK = 'catalog.refill_pairs_block';

const PAIRS: Array<[bottle: string, refill: string]> = [
  ['gel-rua-chen-cho-may-fuwa3e-100ml-e1aa04', 'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'],
  ['gel-rua-chen-cho-may-fuwa3e-500ml-f9915e', 'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'],
  ['gel-rua-chen-cho-may-fuwa3e-2000ml-ea1def', 'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'],
  ['lau-da-nang-fuwa3e-2l-9aa0ed', 'refill-lau-da-nang-fuwa3e-10l-a08433'],
  ['nuoc-lau-san-sa-chanh-fuwa3e-100ml-d10bec', 'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l-b63811'],
  ['nuoc-lau-san-sa-chanh-fuwa3e-1l-51b16f', 'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l-b63811'],
  ['nuoc-ngam-rua-thuc-pham-fuwa3e-100ml-8b4cd8', 'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5'],
  ['nuoc-ngam-rua-thuc-pham-fuwa3e-1l-809601', 'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5'],
  ['nuoc-rua-chen-fuwa3e-100ml-c1337b', 'refill-nuoc-rua-chen-fuwa3e-10l-69f244'],
  ['nuoc-rua-chen-fuwa3e-500ml-185d77', 'refill-nuoc-rua-chen-fuwa3e-10l-69f244'],
  ['nuoc-rua-tay-dang-bot-fuwa3e-300ml-fdf345', 'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l-ab8688'],
  ['nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0', 'refill-nuoc-rua-tay-dang-gel-fuwa3e-10l-f3ac3e'],
];
const ALL = PAIRS.map(([bottleSlug, refillSlug]) => ({ bottleSlug, refillSlug }));
const bottlesExcept = (...skip: number[]) => ALL.filter((_, i) => !skip.includes(i)).map((o) => o.bottleSlug);

describe('migration ghép 12 cặp Refill (real Postgres)', () => {
  const prisma = new PrismaClient();
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

  async function product(slug: string, opts: { brand?: string; isCombo?: boolean; isActive?: boolean; approval?: string } = {}) {
    await exec(
      `INSERT INTO ${SCHEMA}.products ("id", "brand", "slug", "name", "description", "basePrice", "updatedAt", "isCombo", "isActive", "approvalStatus")
       VALUES (${lit(`p-${slug}`)}, ${lit(opts.brand ?? 'Fuwa3e')}, ${lit(slug)}, ${lit(slug)}, '', 1000, now(), ${opts.isCombo === true}, ${opts.isActive !== false},
               ${lit(opts.approval ?? 'APPROVED')})
       ON CONFLICT ("slug") DO NOTHING`,
    );
  }
  async function config(key: string, value: unknown) {
    await exec(`INSERT INTO ${SCHEMA}.system_configs ("key", "value", "category", "updatedAt") VALUES (${lit(key)}, ${json(value)}, 'catalog', now())`);
  }
  async function overrides(): Promise<unknown> {
    const r = await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(`SELECT "value" FROM ${SCHEMA}.system_configs WHERE "key" = ${lit(OVERRIDE)}`);
    return r[0]?.value;
  }
  const bottleSlugs = async () => ((await overrides()) as Array<{ bottleSlug: string }>).map((o) => o.bottleSlug);
  async function history(): Promise<Array<{ id: string; oldValue: unknown; newValue: unknown; changedBy: string }>> {
    return prisma.$queryRawUnsafe(`SELECT "id", "oldValue", "newValue", "changedBy" FROM ${SCHEMA}.system_config_history ORDER BY "changedAt"`);
  }
  async function catalog() {
    for (const slug of new Set(PAIRS.flat())) await product(slug);
  }

  beforeEach(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ['system_configs', 'system_config_history', 'products']) await exec(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('mảng rỗng: cộng đủ 12 cặp theo thứ tự, ghi một dòng lịch sử', async () => {
    await catalog();
    await config(OVERRIDE, []);
    await run();
    expect(await overrides()).toEqual(ALL);
    expect(await history()).toEqual([{ id: 'sch_w903_refill_link_12', oldValue: [], newValue: ALL, changedBy: 'migration:tubu-w9-03' }]);
  });

  it('chạy lại: không đổi gì, không thêm lịch sử', async () => {
    await catalog();
    await config(OVERRIDE, []);
    await run();
    await run();
    expect(await overrides()).toEqual(ALL);
    expect(await history()).toHaveLength(1);
  });

  it('cặp admin đã ghép (chai này với gói khác) và mục lạ giữ nguyên ở đầu; chỉ cộng 11 cặp còn lại', async () => {
    await catalog();
    const admin = [{ bottleSlug: PAIRS[0]![0], refillSlug: 'refill-khac-fuwa3e-5l' }, { bottleSlug: 'chai-x', refillSlug: 'refill-y' }, 'rac'];
    await config(OVERRIDE, admin);
    await run();
    expect(await overrides()).toEqual([...admin, ...ALL.slice(1)]);
  });

  it('slug bị chặn (chai hay gói) thì bỏ đúng các cặp đó', async () => {
    await catalog();
    await config(OVERRIDE, []);
    await config(BLOCK, [PAIRS[3]![0], 'refill-nuoc-rua-chen-fuwa3e-10l-69f244']);
    await run();
    expect(await bottleSlugs()).toEqual(bottlesExcept(3, 8, 9));
  });

  it('không tạo vòng: chai đang làm đích của cặp khác, hay gói Refill đang làm chai, thì bỏ cặp đó', async () => {
    await catalog();
    const admin = [
      { bottleSlug: 'chai-z', refillSlug: PAIRS[4]![0] },
      { bottleSlug: PAIRS[10]![1], refillSlug: 'refill-z' },
    ];
    await config(OVERRIDE, admin);
    await run();
    const got = (await overrides()) as Array<{ bottleSlug: string }>;
    expect(got.slice(0, 2)).toEqual(admin);
    expect(got.slice(2).map((o) => o.bottleSlug)).toEqual(bottlesExcept(4, 10));
  });

  it('chai thiếu, chai là combo, khác thương hiệu, gói thiếu: bỏ đúng cặp đó', async () => {
    for (const [i, [bottle, refill]] of PAIRS.entries()) {
      if (i === 1) await product(bottle, { isCombo: true });
      else if (i === 2) await product(bottle, { brand: 'Pineboo' });
      else if (i !== 0) await product(bottle);
      if (i !== 3) await product(refill);
    }
    await config(OVERRIDE, []);
    await run();
    expect(await bottleSlugs()).toEqual(bottlesExcept(0, 1, 2, 3));
  });

  it('sản phẩm không đang bán (tắt, chờ duyệt, bị từ chối) hay gói là combo: bỏ đúng cặp đó, như luật lưu của thẻ admin', async () => {
    for (const [i, [bottle, refill]] of PAIRS.entries()) {
      if (i === 0) await product(bottle, { isActive: false });
      else if (i === 1) await product(bottle, { approval: 'PENDING_REVIEW' });
      else await product(bottle);
      if (i === 3) await product(refill, { isActive: false });
      else if (i === 10) await product(refill, { isCombo: true });
      else if (i === 11) await product(refill, { approval: 'REJECTED' });
      else await product(refill);
    }
    await config(OVERRIDE, []);
    await run();
    expect(await bottleSlugs()).toEqual(bottlesExcept(0, 1, 3, 10, 11));
  });

  it('DB không có slug PROD nào (dev, e2e): không đổi gì, không lịch sử', async () => {
    await config(OVERRIDE, []);
    await run();
    expect(await overrides()).toEqual([]);
    expect(await history()).toHaveLength(0);
  });

  it('khoá chưa có hay không phải mảng: không tạo, không sửa, không lỗi', async () => {
    await catalog();
    await run();
    expect(await overrides()).toBeUndefined();
    await config(OVERRIDE, { sai: 'dang' });
    await run();
    expect(await overrides()).toEqual({ sai: 'dang' });
    expect(await history()).toHaveLength(0);
  });
});
