import { execFile, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { DEALER_TIERS, MISSIONS, NOTIFICATION_TEMPLATES, PLANT_SPECIES, SYSTEM_CONFIGS, TIERS } from '../../prisma/seed';
import { QUIZZES as NATURE_QUIZZES } from '../../prisma/seed-game-quiz';
import { COMMUNITY_GOAL_SEED, SEASON_SEED } from '../../prisma/reference-data/garden';
import { selectBusinessConfigs, selectReferenceConfigs } from '../../prisma/reference-data/config-selection';
import { seedReference, WITH_BUSINESS_DEFAULTS_FLAG, type GroupResult } from '../../prisma/seed-reference';
import { COMMUNITY_CATEGORIES } from '../../src/modules/feed/community-categories-seed';

/**
 * `prisma/seed-reference.ts` trên Postgres THẬT, trên DB trống ngay sau `prisma migrate deploy` (D4-001, D4-021).
 * Không cờ: chỉ nạp phần tham chiếu. `--with-business-defaults`: nạp thêm hạng, bậc đại lý, nhiệm vụ, 6 khoá giá trị kinh doanh.
 * Mỗi nhóm test dựng DB riêng `tubutree_it_refseed_*` trong cùng máy chủ rồi xoá, vì DB `tubutree_it` dùng chung đã có dữ
 * liệu của các spec khác. Cần quyền CREATE DATABASE (container race của gói có sẵn).
 */
const run = promisify(execFile);
const API_ROOT = join(__dirname, '../..');
const BASE_URL = new URL(process.env.DATABASE_URL!);
const SUFFIX = `${process.pid}_${Date.now().toString(36)}`;

const scratch = (tag: string) => {
  const name = `tubutree_it_refseed_${tag}_${SUFFIX}`;
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
};
const A = scratch('a');
const B = scratch('b');
const C = scratch('c');

const clientFor = (url: string) => new PrismaClient({ datasources: { db: { url } } });

describe('seed-reference trên DB trống sau migrate deploy (real Postgres)', () => {
  let admin: PrismaClient;
  let pa: PrismaClient;
  let pb: PrismaClient;
  let pc: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient();
    for (const db of [A, B, C]) await admin.$executeRawUnsafe(`CREATE DATABASE "${db.name}"`);
    await Promise.all(
      [A, B, C].map((db) => run('npx', ['prisma', 'migrate', 'deploy'], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: db.url } })),
    );
    pa = clientFor(A.url);
    pb = clientFor(B.url);
    pc = clientFor(C.url);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([pa, pb, pc].map((p) => p?.$disconnect()));
    for (const db of [A, B, C]) await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
    await admin?.$disconnect();
  }, 60_000);

  const seasonStillValid = SEASON_SEED.endAt > new Date();
  const baseConfigKeys = selectReferenceConfigs(SYSTEM_CONFIGS).map((c) => c.key);
  const businessConfigKeys = selectBusinessConfigs(SYSTEM_CONFIGS).map((c) => c.key);

  const has = async (rows: { id?: string; key?: string; code?: string; slug?: string }[], expected: string[], field: 'id' | 'key' | 'code' | 'slug') =>
    expect(expected.filter((e) => !rows.some((r) => r[field] === e))).toEqual([]);

  async function expectBaseReferencePresent(p: PrismaClient, seasonRows: number = seasonStillValid ? 1 : 0) {
    await has(await p.systemConfig.findMany({ select: { key: true } }), baseConfigKeys, 'key');
    await has(await p.notificationTemplate.findMany({ select: { code: true } }), NOTIFICATION_TEMPLATES.map((t) => t.code), 'code');
    await has(await p.communityCategory.findMany({ select: { slug: true } }), COMMUNITY_CATEGORIES.map((c) => c.slug), 'slug');
    await has(await p.gameQuiz.findMany({ select: { id: true } }), NATURE_QUIZZES.map((q) => q.id), 'id');
    await has(await p.plantSpecies.findMany({ select: { id: true } }), PLANT_SPECIES.map((s) => s.id), 'id');
    expect(await p.communityGoal.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await p.season.count({ where: { id: SEASON_SEED.id } })).toBe(seasonRows);
  }

  async function expectBusinessPresent(p: PrismaClient) {
    await has(await p.systemConfig.findMany({ select: { key: true } }), businessConfigKeys, 'key');
    await has(await p.membershipTier.findMany({ select: { id: true } }), TIERS.map((t) => t.id), 'id');
    await has(await p.dealerTier.findMany({ select: { id: true } }), DEALER_TIERS.map((t) => t.id), 'id');
    await has(await p.mission.findMany({ select: { code: true } }), MISSIONS.map((m) => m.code), 'code');
  }

  /** Không cờ: hạng, bậc đại lý, nhiệm vụ và 6 khoá giá trị kinh doanh phải vắng hẳn (DB sau migrate chưa có chúng). */
  async function expectBusinessAbsent(p: PrismaClient) {
    expect(await p.membershipTier.count()).toBe(0);
    expect(await p.dealerTier.count()).toBe(0);
    expect(await p.mission.count()).toBe(0);
    expect(await p.systemConfig.count({ where: { key: { in: businessConfigKeys } } })).toBe(0);
  }

  async function snapshot(p: PrismaClient) {
    return {
      configs: await p.systemConfig.findMany({ orderBy: { key: 'asc' } }),
      tiers: await p.membershipTier.findMany({ orderBy: { id: 'asc' } }),
      dealerTiers: await p.dealerTier.findMany({ orderBy: { id: 'asc' } }),
      templates: await p.notificationTemplate.findMany({ orderBy: { code: 'asc' } }),
      categories: await p.communityCategory.findMany({ orderBy: { slug: 'asc' } }),
      quizzes: await p.gameQuiz.findMany({ orderBy: { id: 'asc' } }),
      missions: await p.mission.findMany({ orderBy: { code: 'asc' } }),
      species: await p.plantSpecies.findMany({ orderBy: { id: 'asc' } }),
      goals: await p.communityGoal.findMany({ orderBy: { id: 'asc' } }),
      seasons: await p.season.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  const cliEnv = (db: { url: string }) => ({ ...process.env, DATABASE_URL: db.url, NODE_ENV: 'production' });
  const runCli = (db: { url: string }, args: string[] = []) =>
    spawnSync('npx', ['tsx', 'prisma/seed-reference.ts', ...args], { cwd: API_ROOT, env: cliEnv(db), encoding: 'utf-8' });
  const withFlag = { withBusinessDefaults: true };

  const createdBy = (results: GroupResult[]) => Object.fromEntries(results.map((r) => [r.group, r.created]));
  const noneCreated = (results: GroupResult[]) => expect(results.filter((r) => r.created > 0)).toEqual([]);

  describe('DB A: lệnh chạy thật trên prod, rồi chạy lại, sửa tay, xoá, rồi nạp giá trị kinh doanh', () => {
    const protectedState = async () => ({
      products: await pa.product.count(),
      variations: await pa.variation.count(),
      users: await pa.user.count(),
      coupons: await pa.coupon.count(),
      cashbackMerchants: await pa.cashbackMerchant.count(),
      roleGrants: await pa.roleGrant.count(),
      payment: await pa.systemConfig.findMany({ where: { key: { startsWith: 'payment.' } }, orderBy: { key: 'asc' } }),
      shipping: await pa.systemConfig.findMany({ where: { key: { startsWith: 'shipping.', notIn: businessConfigKeys } }, orderBy: { key: 'asc' } }),
    });

    it('không cờ, NODE_ENV=production, DB vừa migrate: thoát 0, nhóm tham chiếu có dữ liệu, nhóm giá trị kinh doanh vắng, sản phẩm/người dùng/mã giảm giá/thanh toán/phí ship không đổi', async () => {
      await pa.systemConfig.upsert({
        where: { key: 'payment.bank_account_no' },
        update: { value: '1234567890' },
        create: { key: 'payment.bank_account_no', value: '1234567890', category: 'payment' },
      });
      await pa.user.create({ data: { referralCode: 'REFSEEDIT1', fullName: 'Khach that' } });
      const before = await protectedState();

      const res = runCli(A);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('[seed-reference] notification_templates: +28 mới');
      expect(res.stdout).toContain(`chưa nạp (giá trị kinh doanh chờ chủ dự án duyệt): business_configs, membership_tiers, dealer_tiers, missions`);
      expect(res.stdout).not.toContain('membership_tiers: +');
      await expectBaseReferencePresent(pa);
      await expectBusinessAbsent(pa);
      expect(await protectedState()).toEqual(before);
      // go-live:check WARN khi chưa có hai khoá này: nạp 200k/19k sẽ che mất cảnh báo trước khi chủ shop xác nhận.
      expect(await pa.systemConfig.count({ where: { key: { in: ['shipping.free_threshold', 'shipping.flat_fee_below_threshold'] } } })).toBe(0);
    }, 120_000);

    it('chạy lần 2 không cờ: không tạo gì, không dòng nào bị ghi lại', async () => {
      const before = await snapshot(pa);
      noneCreated(await seedReference(pa));
      expect(await snapshot(pa)).toEqual(before);
    });

    it('sửa tay mỗi nhóm tham chiếu một dòng rồi chạy lại: mọi chỉnh sửa còn nguyên, không tạo thêm', async () => {
      await pa.systemConfig.update({ where: { key: 'loyalty.vnd_per_point' }, data: { value: 12345 } });
      await pa.systemConfig.update({ where: { key: 'community.rep_post' }, data: { value: 9 } });
      await pa.notificationTemplate.update({ where: { code: 'ORDER_DELIVERED' }, data: { bodyTemplate: 'Admin đã sửa lời tin', zaloTemplateId: '123456' } });
      await pa.communityCategory.update({ where: { slug: 'meo-hay' }, data: { name: 'Mẹo (sửa)', isActive: false } });
      await pa.gameQuiz.update({ where: { id: 'nq_cay_1' }, data: { question: 'Câu đã sửa?' } });
      await pa.plantSpecies.update({ where: { id: 'sp-tram' }, data: { story: 'Đã sửa' } });
      await pa.communityGoal.update({ where: { id: COMMUNITY_GOAL_SEED.id }, data: { title: 'Mốc đã sửa', currentDrops: 7, status: 'DONE' } });
      const before = await snapshot(pa);

      noneCreated(await seedReference(pa));

      const after = await snapshot(pa);
      expect(after).toEqual(before);
      expect(after.configs.find((c) => c.key === 'loyalty.vnd_per_point')?.value).toBe(12345);
      expect(after.templates.find((t) => t.code === 'ORDER_DELIVERED')?.zaloTemplateId).toBe('123456');
      expect(after.categories.find((c) => c.slug === 'meo-hay')?.isActive).toBe(false);
      // Mốc admin đã chốt (DONE) không bị thay bằng một mốc ACTIVE mới.
      expect(await pa.communityGoal.count({ where: { status: 'ACTIVE' } })).toBe(0);
    });

    it('xoá một khoá cấu hình và một mẫu tin: chỉ hai dòng đó được tạo lại, đúng giá trị mặc định', async () => {
      await pa.notificationTemplate.delete({ where: { code: 'WELCOME_VOUCHER' } });
      await pa.systemConfig.delete({ where: { key: 'game.dew_seeds' } });
      const before = await snapshot(pa);

      const results = await seedReference(pa);

      expect(createdBy(results)).toMatchObject({ notification_templates: 1, system_configs: 1, community_categories: 0 });
      const after = await snapshot(pa);
      expect(after.configs.find((c) => c.key === 'game.dew_seeds')?.value).toBe(15);
      expect(after.templates.find((t) => t.code === 'WELCOME_VOUCHER')).toBeDefined();
      expect({ ...after, templates: [], configs: [] }).toEqual({ ...before, templates: [], configs: [] });
    });

    it('cờ gõ sai: thoát khác 0 và không ghi gì (không lặng lẽ chạy như không cờ)', async () => {
      const before = await snapshot(pa);
      const res = runCli(A, ['--with-business-default']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('không hợp lệ');
      expect(await snapshot(pa)).toEqual(before);
    }, 60_000);

    it('có cờ --with-business-defaults: nạp hạng, bậc đại lý, nhiệm vụ, 6 khoá; phần tham chiếu đã sửa tay và dữ liệu thật không đổi', async () => {
      const before = await protectedState();
      const baseBefore = await snapshot(pa);

      const res = runCli(A, [WITH_BUSINESS_DEFAULTS_FLAG]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('[seed-reference] membership_tiers: +4 mới');
      expect(res.stdout).toContain('[seed-reference] missions: +4 mới');
      expect(res.stdout).not.toContain('chưa nạp');
      await expectBusinessPresent(pa);
      const after = await snapshot(pa);
      const withoutBusiness = (snap: typeof after) => ({
        ...snap,
        tiers: [],
        dealerTiers: [],
        missions: [],
        configs: snap.configs.filter((c) => !businessConfigKeys.includes(c.key)),
      });
      expect(withoutBusiness(after)).toEqual(withoutBusiness(baseBefore));
      expect(await protectedState()).toEqual(before);
    }, 120_000);

    it('sửa tay hạng, bậc đại lý, nhiệm vụ và bảng giải vòng quay rồi chạy lại có cờ: chỉnh sửa còn nguyên, không tạo thêm', async () => {
      await pa.membershipTier.update({ where: { id: 'LOC_BIEC' }, data: { minPoints: 111, name: 'Lộc Biếc (sửa)' } });
      await pa.dealerTier.update({ where: { id: 'DEALER_1' }, data: { creditLimit: 777 } });
      await pa.mission.update({ where: { code: 'FIRST_ORDER' }, data: { rewardPoints: 3 } });
      await pa.systemConfig.update({ where: { key: 'game.spin_prizes' }, data: { value: [] } });
      const before = await snapshot(pa);

      noneCreated(await seedReference(pa, withFlag));

      const after = await snapshot(pa);
      expect(after).toEqual(before);
      expect(after.tiers.find((t) => t.id === 'LOC_BIEC')?.minPoints).toBe(111);
      expect(after.configs.find((c) => c.key === 'game.spin_prizes')?.value).toEqual([]);
    });

    it('xoá một nhiệm vụ và một khoá giá trị kinh doanh: chạy có cờ tạo lại đúng hai dòng', async () => {
      await pa.mission.delete({ where: { code: 'REVIEW_3' } });
      await pa.systemConfig.delete({ where: { key: 'game.streak_7_bonus' } });

      const results = await seedReference(pa, withFlag);

      expect(createdBy(results)).toMatchObject({ missions: 1, business_configs: 1, membership_tiers: 0, dealer_tiers: 0, system_configs: 0 });
      expect((await pa.mission.findUnique({ where: { code: 'REVIEW_3' } }))?.rewardPoints).toBe(MISSIONS.find((m) => m.code === 'REVIEW_3')!.rewardPoints);
    });
  });

  describe('DB B: ba tiến trình thật cùng chạy trên DB trống (có cờ)', () => {
    const createdInOutput = (stdout: string, group: string) => Number(new RegExp(`\\[seed-reference\\] ${group}: \\+(\\d+) mới`).exec(stdout)?.[1] ?? 0);

    it('cả ba thoát 0, mỗi dòng được tạo đúng một lần (tổng số dòng tạo của ba tiến trình bằng số dòng thiếu trước khi chạy)', async () => {
      const allConfigKeys = [...baseConfigKeys, ...businessConfigKeys];
      const missing = {
        system_configs: baseConfigKeys.length - (await pb.systemConfig.count({ where: { key: { in: baseConfigKeys } } })),
        business_configs: businessConfigKeys.length - (await pb.systemConfig.count({ where: { key: { in: businessConfigKeys } } })),
        notification_templates: NOTIFICATION_TEMPLATES.length - (await pb.notificationTemplate.count({ where: { code: { in: NOTIFICATION_TEMPLATES.map((t) => t.code) } } })),
      };
      expect(allConfigKeys.length).toBe(new Set(allConfigKeys).size);

      const runs = await Promise.all(
        [1, 2, 3].map(() => run('npx', ['tsx', 'prisma/seed-reference.ts', WITH_BUSINESS_DEFAULTS_FLAG], { cwd: API_ROOT, env: cliEnv(B) })),
      );

      const total = (group: string) => runs.reduce((n, r) => n + createdInOutput(r.stdout, group), 0);
      expect(total('system_configs')).toBe(missing.system_configs);
      expect(total('business_configs')).toBe(missing.business_configs);
      expect(total('notification_templates')).toBe(missing.notification_templates);
      expect(total('membership_tiers')).toBe(TIERS.length);
      expect(total('dealer_tiers')).toBe(DEALER_TIERS.length);
      expect(total('missions')).toBe(MISSIONS.length);
      expect(total('game_quizzes')).toBe(NATURE_QUIZZES.length);
      expect(total('community_categories')).toBe(COMMUNITY_CATEGORIES.length);
      expect(total('community_goals')).toBe(1);
      expect(await pb.communityGoal.count()).toBe(1);
      await expectBaseReferencePresent(pb);
      await expectBusinessPresent(pb);
    }, 120_000);
  });

  describe('DB C: seed.ts gốc (dev) vẫn chạy và hai bên không lệch nhau', () => {
    it('seed.ts thoát 0 trên DB trống; seed-reference chạy sau đó (kể cả có cờ) chỉ thêm các khoá bổ sung mà seed.ts không có', async () => {
      const seed = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: C.url, NODE_ENV: 'development' },
        encoding: 'utf-8',
      });
      expect(seed.status).toBe(0);
      expect(seed.stdout).toContain('Seed done.');
      // seed.ts nạp thêm dữ liệu dev: sản phẩm, mã giảm giá, 6 quiz thương hiệu cũ, đối tác cashback.
      expect(await pc.product.count()).toBeGreaterThan(0);
      expect(await pc.gameQuiz.count()).toBe(NATURE_QUIZZES.length + 6);

      const results = await seedReference(pc, withFlag);

      expect(createdBy(results)).toMatchObject({
        business_configs: 0,
        membership_tiers: 0,
        dealer_tiers: 0,
        missions: 0,
        notification_templates: 0,
        community_categories: 0,
        game_quizzes: 0,
        plant_species: 0,
        community_goals: 0,
      });
      const extraKeys = [
        'community.rep_post',
        'community.rep_answer',
        'community.rep_best',
        'community.daily_rep_cap',
        'community.rep_thresholds',
        'affiliate.max_rate_pct',
        'affiliate.default_rate_pct',
        'affiliate.commission_eligible_roles',
        'storefront.require_approval',
        'storefront.subdomain_enabled',
        'pancake.total_mismatch_check',
        'pancake.category_map',
        'pancake.external_capture_enabled',
        'pancake.order_source_map',
        'dealer.review_hours',
        'community.public_preview',
        'home.new_customer_layout',
      ];
      expect(createdBy(results).system_configs).toBe(extraKeys.length);
      expect(await pc.systemConfig.count({ where: { key: { in: extraKeys } } })).toBe(extraKeys.length);
      // seed.ts (dev) nạp cả mùa mẫu đã hết hạn; seed-reference thì không (kiểm ở DB A và B).
      await expectBaseReferencePresent(pc, 1);
      await expectBusinessPresent(pc);
    }, 120_000);
  });
});
