import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn, splitSqlStatements } from './sql-script';

/**
 * points-1d: migration 20261018210000_points_1d nhân 1.000 mọi số điểm (1 điểm = 1.000đ thành 1 điểm = 1đ), đổi hạng theo
 * chi tiêu và các khoá cấu hình tính bằng điểm. Chạy lại CHÍNH file migration.sql trên một schema nháp (bảng dựng bằng
 * LIKE public.* INCLUDING ALL nên có đủ CHECK, unique và index của DB thật) để dữ liệu mẫu không đụng bảng public.
 */
const SCHEMA = 'pts1d_mig';
const MIGRATION = readApiSql('prisma/migrations/20261018210000_points_1d/migration.sql');
const PD3_ROLLBACK = readApiSql('prisma/manual/pd3_xu_to_points_rollback.sql');
const TABLES = [
  'users',
  'points_transactions',
  'orders',
  'return_requests',
  'reviews',
  'loyalty_check_ins',
  'pos_point_credits',
  'community_events',
  'ctv_milestone_claims',
  'game_spins',
  'missions',
  'membership_tiers',
  'system_configs',
  'system_config_history',
];
const OLD_TS = '2026-01-02 03:04:05';
const REDEEM_KEY = 'loyalty.vnd_per_point_redeem';

describe('points-1d migration nhân 1.000 số điểm (real Postgres)', () => {
  const prisma = new PrismaClient();
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);

  const cfg = (key: string, value: unknown) =>
    exec(`INSERT INTO ${SCHEMA}.system_configs ("key", "value", "category", "updatedAt")
          VALUES ('${key}', '${JSON.stringify(value).replace(/'/g, "''")}'::jsonb, 'x', '${OLD_TS}')
          ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`);
  const cfgValue = async (key: string) => (await q<{ value: unknown }>(`SELECT "value" FROM ${SCHEMA}.system_configs WHERE "key" = '${key}'`))[0]?.value;

  /** Dữ liệu mẫu theo đơn vị CŨ. Mỗi cột bị nhân nằm cạnh một cột KHÔNG bị nhân để kiểm cả hai phía. */
  async function seed() {
    for (const t of TABLES) await exec(`DELETE FROM ${SCHEMA}.${t}`);
    await exec(`INSERT INTO ${SCHEMA}.users ("id", "referralCode", "pointsBalance", "pointsConvertedBalance", "updatedAt") VALUES
      ('u1', 'RC1', 120, 30, '${OLD_TS}'), ('u2', 'RC2', 0, 0, '${OLD_TS}')`);
    await exec(`INSERT INTO ${SCHEMA}.points_transactions ("id", "userId", "delta", "reason", "expiresAt") VALUES
      ('pt1', 'u1', 150, 'A', '2027-05-06 00:00:00'), ('pt2', 'u1', -30, 'B', NULL), ('pt3', 'u1', 0, 'ORDER_REVERSED:X', NULL)`);
    await exec(`INSERT INTO ${SCHEMA}.orders ("id", "code", "userId", "type", "status", "subtotal", "total", "paymentMethod", "paymentStatus",
                  "shippingAddress", "pointsDiscount", "pointsEarned", "pointsUsed", "pointsUsedConverted", "updatedAt") VALUES
      ('o1', 'TUBU1', 'u1', 'RETAIL', 'DELIVERED', 600000, 500000, 'COD', 'PAID', '{}'::jsonb, 14000, 25, 10, 4, '${OLD_TS}')`);
    await exec(`INSERT INTO ${SCHEMA}.return_requests ("id", "orderId", "userId", "reason", "pointsRefunded", "convertedPointsRefunded", "pointsReversed",
                  "refundAmount", "commissionReversed") VALUES ('rr1', 'o1', 'u1', 'x', 5, 2, 7, 12345, 678)`);
    await exec(`INSERT INTO ${SCHEMA}.reviews ("id", "userId", "productId", "orderId", "rating", "pointsEarned") VALUES ('rv1', 'u1', 'p1', 'o1', 5, 15)`);
    await exec(`INSERT INTO ${SCHEMA}.loyalty_check_ins ("id", "userId", "dayKey", "cycleDay", "streakDays", "points") VALUES ('ci1', 'u1', '2026-10-01', 1, 1, 1)`);
    await exec(`INSERT INTO ${SCHEMA}.pos_point_credits ("id", "receiptId", "memberId", "staffUserId", "orderTotal", "points", "multiplier", "dayKey")
                VALUES ('pc1', 'HD1', 'u1', 'u2', 200000, 30, 1.5, '2026-10-01')`);
    await exec(`INSERT INTO ${SCHEMA}.community_events ("id", "title", "startAt", "endAt", "rewardXu", "rewardPoints")
                VALUES ('ev1', 'T', now(), now(), 5000, 20)`);
    await exec(`INSERT INTO ${SCHEMA}.ctv_milestone_claims ("id", "userId", "milestoneId", "monthKey", "rewardXu", "rewardPoints", "revenue")
                VALUES ('cm1', 'u1', 'milestone-3m', '2026-09', 7, 50, 3000000)`);
    await exec(`INSERT INTO ${SCHEMA}.game_spins ("id", "userId", "prizeId", "prizeName", "prizeValue", "rewardType") VALUES
      ('gs1', 'u1', 'p1', '5 điểm Xanh', 5, 'POINTS'), ('gs2', 'u1', 'p4', 'Voucher 20k', 20000, 'COUPON'),
      ('gs3', 'u1', 'p5', '30 giọt', 30, 'SEEDS'), ('gs4', 'u1', 'p8', 'Chúc may mắn', NULL, 'NONE')`);
    await exec(`INSERT INTO ${SCHEMA}.missions ("id", "code", "title", "description", "rewardPoints") VALUES ('m1', 'FIRST_ORDER', 'T', 'D', 20)`);
    await exec(`INSERT INTO ${SCHEMA}.membership_tiers ("id", "name", "minPoints", "minSpending", "perks", "sortOrder") VALUES
      ('MAM_XANH', 'Mầm Xanh', 0, NULL, '[]', 0), ('LOC_BIEC', 'Lộc Biếc', 500, 5000000, '[]', 1),
      ('DAI_THU', 'Đại Thụ', 2000, 20000000, '[]', 2), ('CO_THU', 'Cổ Thụ', 5000, 50000000, '[]', 3)`);
    await exec(`INSERT INTO ${SCHEMA}.system_config_history ("id", "key", "oldValue", "newValue", "changedBy") VALUES ('old_h', 'k', '1'::jsonb, '2'::jsonb, 'admin')`);
    await cfg(REDEEM_KEY, 1000);
    await cfg('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, 2]);
    await cfg('loyalty.pos_staff_daily_points_cap', 3000);
    await cfg('loyalty.pos_member_daily_points_cap', 10_000_000);
    await cfg('referral.referrer_reward_points', 5);
    await cfg('referral.milestones_points', [{ count: 3, bonusPoints: 20 }, { count: 5, bonusPoints: 40 }, { count: 10, bonusPoints: 100 }]);
    await cfg('community.post_reward_points', 1);
    await cfg('community.answer_reward_points', 0);
    await cfg('community.best_answer_reward_points', 1);
    await cfg('game.tree_points_price', 50);
    await cfg('game.spin_buy_cost_points', 10);
    await cfg('game.spin_prizes', [
      { id: 'p1', name: '5 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5 },
      { id: 'p2', name: 'Quà may mắn của tôi', weight: 10, rewardType: 'POINTS', value: 20 },
      { id: 'p4', name: 'Voucher 20k', weight: 10, rewardType: 'COUPON', value: 20000 },
      { id: 'p5', name: '30 💧', weight: 15, rewardType: 'SEEDS', value: 30 },
      { id: 'p7', name: '50 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 50 },
      { id: 'p8', name: 'Chúc may mắn lần sau', weight: 2, rewardType: 'NONE', value: 0 },
    ]);
    await cfg('seasonpass.tiers', [
      { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 300, free: { type: 'SEEDS', amount: 80 }, premium: { type: 'POINTS', amount: 30 } },
    ]);
    // Khoá cấu hình không liên quan: không được đụng.
    await cfg('shipping.free_threshold', 200000);
    await cfg('loyalty.max_redeem_pct', 0.2);
  }

  type Snap = Record<string, unknown[]>;
  /** Toàn bộ nội dung các bảng (cả updatedAt/expiresAt) để so trước và sau. */
  async function snapshot(): Promise<Snap> {
    const out: Snap = {};
    for (const t of TABLES) out[t] = await q(`SELECT * FROM ${SCHEMA}.${t} ORDER BY 1`);
    return out;
  }
  const row = async (table: string, id: string) => (await q<Record<string, unknown>>(`SELECT * FROM ${SCHEMA}.${table} WHERE "id" = '${id}'`))[0]!;

  beforeAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of TABLES) await exec(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
  });

  beforeEach(seed);

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('migration là đúng một khối DO $$ (một giao dịch: hoặc nhân hết hoặc không gì cả)', () => {
    const stmts = splitSqlStatements(MIGRATION);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^DO \$\$[\s\S]*END \$\$$/);
  });

  it('nhân 1.000 mọi cột điểm; cột tiền (đồng) và cột khác giữ nguyên; updatedAt/expiresAt giữ nguyên', async () => {
    await run();

    expect(await row('users', 'u1')).toMatchObject({ pointsBalance: 120_000, pointsConvertedBalance: 30_000, coinsBalance: 0 });
    expect((await row('users', 'u1')).updatedAt).toEqual(new Date(`${OLD_TS.replace(' ', 'T')}.000Z`));
    expect(await row('users', 'u2')).toMatchObject({ pointsBalance: 0, pointsConvertedBalance: 0 });

    const ledger = await q<{ id: string; delta: number; expiresAt: Date | null }>(`SELECT "id", "delta", "expiresAt" FROM ${SCHEMA}.points_transactions ORDER BY "id"`);
    expect(ledger.map((l) => [l.id, l.delta])).toEqual([['pt1', 150_000], ['pt2', -30_000], ['pt3', 0]]);
    expect(ledger[0]!.expiresAt).toEqual(new Date('2027-05-06T00:00:00.000Z'));

    const order = await row('orders', 'o1');
    expect(order).toMatchObject({ pointsEarned: 25_000, pointsUsed: 10_000, pointsUsedConverted: 4_000, pointsDiscount: 14_000, total: 500_000, subtotal: 600_000 });
    expect(order.updatedAt).toEqual(new Date(`${OLD_TS.replace(' ', 'T')}.000Z`));

    expect(await row('return_requests', 'rr1')).toMatchObject({
      pointsRefunded: 5_000, convertedPointsRefunded: 2_000, pointsReversed: 7_000, refundAmount: 12_345, commissionReversed: 678,
    });
    expect(await row('reviews', 'rv1')).toMatchObject({ pointsEarned: 15_000 });
    expect(await row('loyalty_check_ins', 'ci1')).toMatchObject({ points: 1_000 });
    expect(await row('pos_point_credits', 'pc1')).toMatchObject({ points: 30_000, orderTotal: 200_000 });
    expect(await row('community_events', 'ev1')).toMatchObject({ rewardPoints: 20_000, rewardXu: 5000 });
    expect(await row('ctv_milestone_claims', 'cm1')).toMatchObject({ rewardPoints: 50_000, rewardXu: 7, revenue: 3_000_000n });
    expect(await row('missions', 'm1')).toMatchObject({ rewardPoints: 20_000 });

    const spins = await q<{ id: string; prizeValue: number | null; prizeName: string }>(`SELECT "id", "prizeValue", "prizeName" FROM ${SCHEMA}.game_spins ORDER BY "id"`);
    expect(spins.map((s) => [s.id, s.prizeValue])).toEqual([['gs1', 5_000], ['gs2', 20_000], ['gs3', 30], ['gs4', null]]);
    expect(spins[0]!.prizeName).toBe('5 điểm Xanh'); // chữ lịch sử giữ nguyên
  });

  it('bất biến sổ: SUM(delta) của mỗi khách vẫn bằng pointsBalance + pointsConvertedBalance sau khi nhân', async () => {
    await exec(`UPDATE ${SCHEMA}.users SET "pointsBalance" = 120, "pointsConvertedBalance" = 0 WHERE "id" = 'u1'`);
    const before = await q<{ ok: boolean }>(`SELECT (SUM(delta) = 120) AS ok FROM ${SCHEMA}.points_transactions WHERE "userId" = 'u1'`);
    expect(before[0]!.ok).toBe(true);
    await run();
    const [after] = await q<{ ledger: bigint; balance: number }>(`SELECT
      (SELECT SUM(delta) FROM ${SCHEMA}.points_transactions WHERE "userId" = 'u1') AS ledger,
      (SELECT "pointsBalance" + "pointsConvertedBalance" FROM ${SCHEMA}.users WHERE "id" = 'u1') AS balance`);
    expect(Number(after!.ledger)).toBe(after!.balance);
  });

  it('chạy lần hai không làm gì (dấu loyalty.vnd_per_point_redeem = 1), không nhân lần nữa', async () => {
    await run();
    const once = await snapshot();
    await run();
    expect(await snapshot()).toEqual(once);
    expect(await cfgValue(REDEEM_KEY)).toBe(1);
  });

  it('không có dòng loyalty.vnd_per_point_redeem (mặc định cũ 1.000) vẫn chạy và tạo dòng = 1', async () => {
    await exec(`DELETE FROM ${SCHEMA}.system_configs WHERE "key" = '${REDEEM_KEY}'`);
    await run();
    expect(await cfgValue(REDEEM_KEY)).toBe(1);
    expect(await row('users', 'u1')).toMatchObject({ pointsBalance: 120_000 });
    const [h] = await q<{ oldValue: unknown; newValue: unknown }>(`SELECT "oldValue", "newValue" FROM ${SCHEMA}.system_config_history WHERE "key" = '${REDEEM_KEY}'`);
    expect(h).toEqual({ oldValue: 1000, newValue: 1 });
  });

  it.each([['500'], ['2000'], ['"1000"'], ['null']])('tỉ giá đã lưu %s (khác 1.000 và khác 1) → RAISE, không ghi gì', async (bad) => {
    await exec(`UPDATE ${SCHEMA}.system_configs SET "value" = '${bad}'::jsonb WHERE "key" = '${REDEEM_KEY}'`);
    const before = await snapshot();
    await expect(run()).rejects.toThrow(/loyalty\.vnd_per_point_redeem/);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['users', `UPDATE ${SCHEMA}.users SET "pointsBalance" = 3000000 WHERE "id" = 'u1'`, /users\.pointsBalance/],
    ['points_transactions', `UPDATE ${SCHEMA}.points_transactions SET "delta" = -2200000 WHERE "id" = 'pt2'`, /points_transactions\.delta/],
    ['orders', `UPDATE ${SCHEMA}.orders SET "pointsEarned" = 2147484 WHERE "id" = 'o1'`, /orders\.pointsEarned/],
  ])('số dư sẽ tràn INTEGER sau khi nhân (%s) → RAISE nêu bảng và cột, giao dịch lùi hết', async (_name, breakIt, pattern) => {
    await exec(breakIt);
    const before = await snapshot();
    await expect(run()).rejects.toThrow(pattern);
    expect(await snapshot()).toEqual(before);
  });

  it('đúng ngưỡng 2.147.483 điểm vẫn nhân được (2.147.483.000 < INT4 max)', async () => {
    await exec(`UPDATE ${SCHEMA}.users SET "pointsBalance" = 2147483 WHERE "id" = 'u1'`);
    await run();
    expect(await row('users', 'u1')).toMatchObject({ pointsBalance: 2_147_483_000 });
  });

  it('hạng: Lộc Biếc 5 triệu → 1,5 triệu; minPoints = minSpending / 50; Mầm Xanh (không minSpending) giữ minPoints', async () => {
    await run();
    const tiers = await q<{ id: string; minPoints: number; minSpending: number | null }>(`SELECT "id", "minPoints", "minSpending" FROM ${SCHEMA}.membership_tiers ORDER BY "sortOrder"`);
    expect(tiers).toEqual([
      { id: 'MAM_XANH', minPoints: 0, minSpending: null },
      { id: 'LOC_BIEC', minPoints: 30_000, minSpending: 1_500_000 },
      { id: 'DAI_THU', minPoints: 400_000, minSpending: 20_000_000 },
      { id: 'CO_THU', minPoints: 1_000_000, minSpending: 50_000_000 },
    ]);
  });

  it('hạng: Lộc Biếc admin đã đặt mức khác (4 triệu) → giữ 4 triệu, chỉ minPoints theo mức đó', async () => {
    await exec(`UPDATE ${SCHEMA}.membership_tiers SET "minSpending" = 4000000 WHERE "id" = 'LOC_BIEC'`);
    await run();
    expect(await row('membership_tiers', 'LOC_BIEC')).toMatchObject({ minSpending: 4_000_000, minPoints: 80_000 });
  });

  it('khoá cấu hình số: nhân 1.000; POS cap kẹp 1 tỷ; khoá không liên quan giữ nguyên', async () => {
    await run();
    expect(await cfgValue('loyalty.checkin_points')).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 2000]);
    expect(await cfgValue('loyalty.pos_staff_daily_points_cap')).toBe(3_000_000);
    expect(await cfgValue('loyalty.pos_member_daily_points_cap')).toBe(1_000_000_000);
    expect(await cfgValue('referral.referrer_reward_points')).toBe(5000);
    expect(await cfgValue('community.post_reward_points')).toBe(1000);
    expect(await cfgValue('community.answer_reward_points')).toBe(0);
    expect(await cfgValue('community.best_answer_reward_points')).toBe(1000);
    expect(await cfgValue('game.tree_points_price')).toBe(50_000);
    expect(await cfgValue('game.spin_buy_cost_points')).toBe(10_000);
    expect(await cfgValue('referral.milestones_points')).toEqual([
      { count: 3, bonusPoints: 20_000 },
      { count: 5, bonusPoints: 40_000 },
      { count: 10, bonusPoints: 100_000 },
    ]);
    expect(await cfgValue('seasonpass.tiers')).toEqual([
      { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5000 } },
      { xp: 300, free: { type: 'SEEDS', amount: 80 }, premium: { type: 'POINTS', amount: 30_000 } },
    ]);
    expect(await cfgValue('shipping.free_threshold')).toBe(200000);
    expect(await cfgValue('loyalty.max_redeem_pct')).toBe(0.2);
    const [{ updatedAt }] = await q<{ updatedAt: Date }>(`SELECT "updatedAt" FROM ${SCHEMA}.system_configs WHERE "key" = 'game.tree_points_price'`) as [{ updatedAt: Date }];
    expect(updatedAt).toEqual(new Date(`${OLD_TS.replace(' ', 'T')}.000Z`));
  });

  it('giải vòng quay: POINTS nhân 1.000 và đổi tên "N điểm Xanh"; tên admin tự viết, giải không POINTS giữ nguyên', async () => {
    await run();
    expect(await cfgValue('game.spin_prizes')).toEqual([
      { id: 'p1', name: '5.000 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5000 },
      { id: 'p2', name: 'Quà may mắn của tôi', weight: 10, rewardType: 'POINTS', value: 20_000 },
      { id: 'p4', name: 'Voucher 20k', weight: 10, rewardType: 'COUPON', value: 20000 },
      { id: 'p5', name: '30 💧', weight: 15, rewardType: 'SEEDS', value: 30 },
      { id: 'p7', name: '50.000 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 50_000 },
      { id: 'p8', name: 'Chúc may mắn lần sau', weight: 2, rewardType: 'NONE', value: 0 },
    ]);
  });

  it('khoá đã ở đơn vị mới (vượt trần cũ) hoặc có phần tử không hợp lệ thì KHÔNG nhân lần nữa', async () => {
    await cfg('loyalty.checkin_points', [1000, 1000, 1000, 1000, 1000, 1000, 2000]);
    await cfg('referral.referrer_reward_points', 5000);
    await cfg('community.post_reward_points', 1000);
    await cfg('game.tree_points_price', 50_000);
    await cfg('game.spin_buy_cost_points', 10_000);
    await cfg('referral.milestones_points', [{ count: 3, bonusPoints: 20_000 }, { count: 5, bonusPoints: 40 }]);
    await cfg('seasonpass.tiers', [{ xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5000 } }]);
    await cfg('game.spin_prizes', [
      { id: 'p1', name: '5 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5 },
      { id: 'p9', name: '9.000 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 9000 },
    ]);
    await run();
    expect(await cfgValue('loyalty.checkin_points')).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 2000]);
    expect(await cfgValue('referral.referrer_reward_points')).toBe(5000);
    expect(await cfgValue('community.post_reward_points')).toBe(1000);
    expect(await cfgValue('game.tree_points_price')).toBe(50_000);
    expect(await cfgValue('game.spin_buy_cost_points')).toBe(10_000);
    expect(await cfgValue('referral.milestones_points')).toEqual([{ count: 3, bonusPoints: 20_000 }, { count: 5, bonusPoints: 40 }]);
    expect(await cfgValue('seasonpass.tiers')).toEqual([{ xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5000 } }]);
    expect(await cfgValue('game.spin_prizes')).toEqual([
      { id: 'p1', name: '5 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5 },
      { id: 'p9', name: '9.000 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 9000 },
    ]);
  });

  it('giá trị hỏng (số lẻ, chuỗi, mảng thiếu ô) bị bỏ qua chứ không làm migration lỗi', async () => {
    await cfg('referral.referrer_reward_points', 2.5);
    await cfg('community.post_reward_points', '3');
    await cfg('loyalty.checkin_points', [1, 2]);
    await cfg('game.tree_points_price', null);
    await cfg('referral.milestones_points', 'oops');
    await cfg('seasonpass.tiers', [{ xp: 1, premium: { type: 'POINTS', amount: 'x' } }]);
    await run();
    expect(await cfgValue('referral.referrer_reward_points')).toBe(2.5);
    expect(await cfgValue('community.post_reward_points')).toBe('3');
    expect(await cfgValue('loyalty.checkin_points')).toEqual([1, 2]);
    expect(await cfgValue('game.tree_points_price')).toBeNull();
    expect(await cfgValue('referral.milestones_points')).toBe('oops');
    expect(await cfgValue(REDEEM_KEY)).toBe(1);
    expect(await row('users', 'u1')).toMatchObject({ pointsBalance: 120_000 });
  });

  it('system_config_history: mỗi khoá đổi có một dòng (migration:points_1d, cũ → mới), chạy lại không thêm, dòng cũ giữ', async () => {
    await run();
    const rows = await q<{ id: string; key: string; oldValue: unknown; newValue: unknown; changedBy: string }>(
      `SELECT "id", "key", "oldValue", "newValue", "changedBy" FROM ${SCHEMA}.system_config_history WHERE "changedBy" = 'migration:points_1d' ORDER BY "key"`,
    );
    expect(rows.map((r) => r.key).sort()).toEqual([
      'community.best_answer_reward_points',
      'community.post_reward_points',
      'game.spin_buy_cost_points',
      'game.spin_prizes',
      'game.tree_points_price',
      'loyalty.checkin_points',
      'loyalty.pos_member_daily_points_cap',
      'loyalty.pos_staff_daily_points_cap',
      'loyalty.vnd_per_point_redeem',
      'referral.milestones_points',
      'referral.referrer_reward_points',
      'seasonpass.tiers',
    ]);
    const tree = rows.find((r) => r.key === 'game.tree_points_price')!;
    expect(tree).toMatchObject({ oldValue: 50, newValue: 50_000 });
    expect(tree.id).toMatch(/^sch_pts1d_[0-9a-f]{32}$/);
    expect(rows.find((r) => r.key === REDEEM_KEY)).toMatchObject({ oldValue: 1000, newValue: 1 });
    await run();
    expect(await q(`SELECT 1 FROM ${SCHEMA}.system_config_history`)).toHaveLength(rows.length + 1);
    expect((await row('system_config_history', 'old_h')).changedBy).toBe('admin');
  });

  it('guard hoàn tác PD-3: sau points_1d (redeem = 1) file pd3_xu_to_points_rollback.sql từ chối chạy, không đổi gì', async () => {
    await run();
    const before = await snapshot();
    await expect(runSqlScriptIn(prisma, SCHEMA, PD3_ROLLBACK)).rejects.toThrow(/points-1d đã chạy/);
    expect(await snapshot()).toEqual(before);
  });
});
