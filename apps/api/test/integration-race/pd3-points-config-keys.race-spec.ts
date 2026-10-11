import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn } from './sql-script';

/**
 * PD-3 (spec mục 3.1 phần "Đổi khoá config", mục 4; R1): khoá config tính bằng xu được chép sang khoá
 * `*_points` mới bằng CEIL(giá trị / 1000) — KHÔNG chia nguyên rồi ép kiểu (bản nháp `((n+999)/1000)::int`
 * trên numeric cho 5.000 xu → 6 điểm). Chạy CHÍNH file migration.sql trên schema nháp có bảng
 * system_configs dựng bằng LIKE public.system_configs, không đụng bảng public.
 */
const SCHEMA = 'pd3_cfg_mig';
const MIGRATION = readApiSql('prisma/migrations/20261012120000_pd3_points_config_keys/migration.sql');

describe('PD-3 migration đổi khoá config xu → Điểm Xanh (real Postgres)', () => {
  const prisma = new PrismaClient();
  const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);
  const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);

  async function put(key: string, value: unknown) {
    await exec(
      `INSERT INTO ${SCHEMA}.system_configs ("key", "value", "category", "updatedAt") VALUES ($1, $2::jsonb, 'test', '2026-01-01')
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`,
      key,
      JSON.stringify(value),
    );
  }
  async function all(): Promise<Record<string, unknown>> {
    const rows = await prisma.$queryRawUnsafe<{ key: string; value: unknown }[]>(`SELECT "key", "value" FROM ${SCHEMA}.system_configs`);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async function updatedAt(key: string): Promise<string> {
    const [r] = await prisma.$queryRawUnsafe<{ u: string }[]>(`SELECT "updatedAt"::text AS u FROM ${SCHEMA}.system_configs WHERE "key" = $1`, key);
    return r!.u;
  }

  beforeEach(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    await exec(`CREATE TABLE ${SCHEMA}.system_configs (LIKE public.system_configs INCLUDING ALL)`);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('DB trống (không có khoá xu) → không tạo gì, không lỗi', async () => {
    await run();
    expect(await all()).toEqual({});
  });

  it('chép giá trị DB hiện tại bằng CEIL: 5.000 xu → 5 điểm (không phải 6), mốc 20k/40k/100k → 20/40/100, cây 50.000 → 50', async () => {
    await put('coins.referrer_reward', 5000);
    await put('coins.referral_milestones', [
      { count: 10, bonus: 100000 },
      { count: 3, bonus: 20000 },
      { count: 5, bonus: 40000 },
    ]);
    await put('game.tree_xu_price', 50000);
    await run();
    const cfg = await all();
    expect(cfg['referral.referrer_reward_points']).toBe(5);
    // Đổi tên trường bonus → bonusPoints: code mới đọc nhầm bản cũ ra undefined → không cấp.
    expect(cfg['referral.milestones_points']).toEqual([
      { count: 3, bonusPoints: 20 },
      { count: 5, bonusPoints: 40 },
      { count: 10, bonusPoints: 100 },
    ]);
    expect(cfg['game.tree_points_price']).toBe(50);
    // Khoá cũ giữ nguyên (không xoá dữ liệu); code mới không đọc chúng (DEAD).
    expect(cfg['coins.referrer_reward']).toBe(5000);
    expect(cfg['game.tree_xu_price']).toBe(50000);
  });

  it('làm tròn LÊN số lẻ: 5.001 → 6, 1 → 1, 0 → 0; mốc 12.001 → 13', async () => {
    await put('coins.referrer_reward', 5001);
    await put('coins.referral_milestones', [{ count: 2, bonus: 12001 }, { count: 4, bonus: 1 }]);
    await put('game.tree_xu_price', 0);
    await run();
    const cfg = await all();
    expect(cfg['referral.referrer_reward_points']).toBe(6);
    expect(cfg['referral.milestones_points']).toEqual([
      { count: 2, bonusPoints: 13 },
      { count: 4, bonusPoints: 1 },
    ]);
    expect(cfg['game.tree_points_price']).toBe(0);
  });

  it('Season Pass: phần XU → POINTS ceil(n/1000), SEEDS giữ nguyên, thứ tự bậc giữ nguyên', async () => {
    await put('seasonpass.tiers', [
      { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'XU', amount: 5000 } },
      { xp: 70, free: { type: 'XU', amount: 12001 }, premium: { type: 'XU', amount: 8000 } },
      { xp: 120, free: { type: 'SEEDS', amount: 40 }, premium: { type: 'SEEDS', amount: 99 } },
    ]);
    await run();
    expect((await all())['seasonpass.tiers']).toEqual([
      { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 70, free: { type: 'POINTS', amount: 13 }, premium: { type: 'POINTS', amount: 8 } },
      { xp: 120, free: { type: 'SEEDS', amount: 40 }, premium: { type: 'SEEDS', amount: 99 } },
    ]);
  });

  it('Season Pass không còn phần XU → không ghi lại (updatedAt giữ nguyên)', async () => {
    await put('seasonpass.tiers', [{ xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5 } }]);
    const before = await updatedAt('seasonpass.tiers');
    await run();
    expect(await updatedAt('seasonpass.tiers')).toBe(before);
  });

  it('trần cộng đồng/ngày: giá trị mặc định cũ (3 bài, 5 hay nhất) → 1 và 3; giá trị admin đã đổi giữ nguyên', async () => {
    await put('community.daily_post_reward_cap', 3);
    await put('community.daily_best_answer_cap', 5);
    await run();
    let cfg = await all();
    expect(cfg['community.daily_post_reward_cap']).toBe(1);
    expect(cfg['community.daily_best_answer_cap']).toBe(3);

    await put('community.daily_post_reward_cap', 2);
    await put('community.daily_best_answer_cap', 4);
    await run();
    cfg = await all();
    expect(cfg['community.daily_post_reward_cap']).toBe(2);
    expect(cfg['community.daily_best_answer_cap']).toBe(4);
  });

  it('chạy lại không đổi gì; khoá điểm admin đã sửa sau migration KHÔNG bị chép đè', async () => {
    await put('coins.referrer_reward', 5000);
    await put('coins.referral_milestones', [{ count: 3, bonus: 20000 }]);
    await put('game.tree_xu_price', 50000);
    await put('seasonpass.tiers', [{ xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'XU', amount: 5000 } }]);
    await run();
    const first = await all();
    await run();
    expect(await all()).toEqual(first);

    await put('referral.referrer_reward_points', 7);
    await put('coins.referrer_reward', 9000);
    await run();
    expect((await all())['referral.referrer_reward_points']).toBe(7);
  });

  it('giá trị cũ sai kiểu (null, chuỗi chữ, mốc thiếu bonus) → bỏ qua, migration KHÔNG lỗi', async () => {
    await put('coins.referrer_reward', null);
    await put('game.tree_xu_price', 'abc');
    await put('coins.referral_milestones', [{ count: 3 }, { count: 'x', bonus: 1000 }, { count: 5, bonus: 40000 }]);
    await put('seasonpass.tiers', [
      { xp: 30, free: { type: 'XU', amount: 'nhieu' }, premium: { type: 'XU', amount: 5000 } },
      { xp: 70 },
    ]);
    await run();
    const cfg = await all();
    expect(cfg['referral.referrer_reward_points']).toBeUndefined();
    expect(cfg['game.tree_points_price']).toBeUndefined();
    expect(cfg['referral.milestones_points']).toEqual([{ count: 5, bonusPoints: 40 }]);
    // Phần XU không có số giữ nguyên XU (code mới từ chối cấp XU), bậc thiếu free/premium không bị thêm khoá null.
    expect(cfg['seasonpass.tiers']).toEqual([
      { xp: 30, free: { type: 'XU', amount: 'nhieu' }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 70 },
    ]);
  });

  it('mốc giới thiệu không phải mảng → không tạo khoá mới', async () => {
    await put('coins.referral_milestones', { count: 3, bonus: 20000 });
    await run();
    expect((await all())['referral.milestones_points']).toBeUndefined();
  });
});
