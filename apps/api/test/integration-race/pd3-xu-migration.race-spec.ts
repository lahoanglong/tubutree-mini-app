import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn, splitSqlStatements } from './sql-script';

/**
 * PD-3 Q-03a (spec mục 3.2, 3.5; T1, T2, T3, T21): quy đổi xu → Điểm Xanh lô CONVERTED, 1.000 xu = 1
 * điểm làm tròn lên, chạy một lần lúc deploy, và SQL hoàn tác chạy tay.
 *
 * Chạy lại CHÍNH file migration.sql / file hoàn tác trên một schema nháp (bảng users/points/coin dựng
 * bằng LIKE public.* INCLUDING ALL nên có đủ CHECK, unique và partial unique index của DB thật), để dữ
 * liệu mẫu (số dư lệch, âm) không đụng bảng public mà các race spec khác dùng.
 */
const SCHEMA = 'pd3_xu_mig';
const MIGRATION_B = readApiSql('prisma/migrations/20261012110000_pd3_xu_to_points/migration.sql');
const ROLLBACK = readApiSql('prisma/manual/pd3_xu_to_points_rollback.sql');

describe('PD-3 migration B quy đổi xu → Điểm Xanh (real Postgres)', () => {
  const prisma = new PrismaClient();
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const runB = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION_B);
  const runRollback = () => runSqlScriptIn(prisma, SCHEMA, ROLLBACK);

  /** User có số dư xu khớp sổ (mặc định một dòng coin +coins; `coinRows` = [] để dựng sổ lệch) và điểm thường khớp sổ. */
  async function seedUser(id: string, coins: number, points = 0, coinRows?: number[]) {
    await exec(`INSERT INTO ${SCHEMA}.users ("id", "referralCode", "coinsBalance", "pointsBalance", "updatedAt")
                VALUES ('${id}', 'RC_${id}', ${coins}, ${points}, now())`);
    const rows = coinRows ?? (coins !== 0 ? [coins] : []);
    for (const [i, d] of rows.entries()) {
      await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType")
                  VALUES ('seed_c_${id}_${i}', '${id}', ${d}, 'SEED', 'TEST')`);
    }
    if (points !== 0) {
      await exec(`INSERT INTO ${SCHEMA}.points_transactions ("id", "userId", "delta", "reason", "refType", "expiresAt")
                  VALUES ('seed_p_${id}', '${id}', ${points}, 'SEED', 'TEST', now() + interval '300 days')`);
    }
  }

  type U = { id: string; coinsBalance: number; pointsBalance: number; pointsConvertedBalance: number };
  async function user(id: string): Promise<U> {
    const [u] = await q<U>(`SELECT "id", "coinsBalance", "pointsBalance", "pointsConvertedBalance" FROM ${SCHEMA}.users WHERE "id" = '${id}'`);
    return u!;
  }

  /** Bốn bất biến sau quy đổi (spec 3.3 "Sau migration B"), số user vi phạm từng cái. */
  async function invariants() {
    const [r] = await q<Record<string, number>>(`
      SELECT
        (SELECT count(*)::int FROM ${SCHEMA}.users u WHERE u."pointsConvertedBalance" <>
           COALESCE((SELECT sum(delta) FROM ${SCHEMA}.points_transactions p WHERE p."userId" = u."id" AND p."lot" = 'CONVERTED'), 0)) AS converted_drift,
        (SELECT count(*)::int FROM ${SCHEMA}.users u WHERE u."pointsBalance" <>
           COALESCE((SELECT sum(delta) FROM ${SCHEMA}.points_transactions p WHERE p."userId" = u."id" AND p."lot" = 'STANDARD'), 0)) AS standard_drift,
        (SELECT count(*)::int FROM ${SCHEMA}.users u WHERE u."coinsBalance" <>
           COALESCE((SELECT sum(delta) FROM ${SCHEMA}.coin_transactions c WHERE c."userId" = u."id"), 0)) AS coin_drift`);
    return r!;
  }

  async function counts() {
    const [r] = await q<Record<string, number>>(`
      SELECT (SELECT count(*)::int FROM ${SCHEMA}.xu_points_conversions) AS snapshots,
             (SELECT count(*)::int FROM ${SCHEMA}.points_transactions WHERE "refType" = 'XU_MIGRATION') AS points_rows,
             (SELECT count(*)::int FROM ${SCHEMA}.coin_transactions WHERE "refType" = 'XU_MIGRATION') AS coin_rows,
             (SELECT COALESCE(sum("pointsConvertedBalance"), 0)::int FROM ${SCHEMA}.users) AS converted_total`);
    return r!;
  }

  const SAMPLE: Array<[id: string, coins: number, points: number]> = [
    ['u0', 0, 0],
    ['u1', 1, 0],
    ['u999', 999, 0],
    ['u1000', 1000, 0],
    ['u1001', 1001, 0],
    ['u123456', 123_456, 0],
    ['upts', 3000, 50],
  ];

  beforeAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ['users', 'points_transactions', 'coin_transactions']) {
      await exec(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
    // Khối hoàn tác chỉ đọc orders."pointsUsedConverted".
    await exec(`CREATE TABLE ${SCHEMA}.orders ("id" TEXT PRIMARY KEY, "pointsUsedConverted" INTEGER NOT NULL DEFAULT 0)`);
    for (const [id, coins, points] of SAMPLE) await seedUser(id, coins, points);
    // u0 từng có xu rồi tiêu hết: sổ +500 −500, số dư 0 → không có dòng quy đổi.
    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType") VALUES
                ('u0_a', 'u0', 500, 'SEED', 'TEST'), ('u0_b', 'u0', -500, 'SEED', 'TEST')`);
    // u999: sổ nhiều dòng (1200 − 201).
    await exec(`DELETE FROM ${SCHEMA}.coin_transactions WHERE "userId" = 'u999'`);
    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType") VALUES
                ('u999_a', 'u999', 1200, 'SEED', 'TEST'), ('u999_b', 'u999', -201, 'SEED', 'TEST')`);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('splitSqlStatements tách đúng file có khối DO $$ ... $$', () => {
    const stmts = splitSqlStatements(MIGRATION_B);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "xu_points_conversions"/);
    expect(stmts[1]).toMatch(/^DO \$\$[\s\S]*END \$\$$/);
  });

  it('T1: quy đổi ceil(xu/1000) vào lô CONVERTED, xu về 0, làm tròn 0..999, giữ điểm thường, bất biến hai lô', async () => {
    await runB();

    const expected: Record<string, number> = { u0: 0, u1: 1, u999: 1, u1000: 1, u1001: 2, u123456: 124, upts: 3 };
    for (const [id, pts] of Object.entries(expected)) {
      const u = await user(id);
      expect({ id, coins: u.coinsBalance, converted: u.pointsConvertedBalance }).toEqual({ id, coins: 0, converted: pts });
    }
    expect((await user('upts')).pointsBalance).toBe(50);

    const snaps = await q<{ userId: string; coinsBefore: number; pointsGranted: number; roundingVnd: number; pointsBefore: number }>(
      `SELECT "userId", "coinsBefore", "pointsGranted", "roundingVnd", "pointsBefore" FROM ${SCHEMA}.xu_points_conversions ORDER BY "userId"`,
    );
    expect(snaps.map((s) => [s.userId, s.coinsBefore, s.pointsGranted, s.roundingVnd])).toEqual([
      ['u1', 1, 1, 999],
      ['u1000', 1000, 1, 0],
      ['u1001', 1001, 2, 999],
      ['u123456', 123_456, 124, 544],
      ['u999', 999, 1, 1],
      ['upts', 3000, 3, 0],
    ]);
    expect(snaps.find((s) => s.userId === 'upts')!.pointsBefore).toBe(50);

    // Dòng sổ: CONVERTED, không hạn, khoá refId = userId; dòng xu trừ đúng số dư cũ.
    const ptx = await q<{ lot: string; expiresAt: Date | null; refId: string; delta: number; reason: string }>(
      `SELECT "lot"::text AS lot, "expiresAt", "refId", "delta", "reason" FROM ${SCHEMA}.points_transactions
        WHERE "refType" = 'XU_MIGRATION' AND "userId" = 'u123456'`,
    );
    expect(ptx).toEqual([{ lot: 'CONVERTED', expiresAt: null, refId: 'u123456', delta: 124, reason: 'XU_TO_POINTS:123456' }]);
    const [coinSum] = await q<{ s: number }>(`SELECT COALESCE(sum(delta), 0)::int AS s FROM ${SCHEMA}.coin_transactions`);
    expect(coinSum!.s).toBe(0);

    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
    expect(await counts()).toEqual({ snapshots: 6, points_rows: 6, coin_rows: 6, converted_total: 132 });
  });

  it('T2: chạy lại không nhân đôi; user mới có xu được quy đổi đúng một lần', async () => {
    await runB();
    expect(await counts()).toEqual({ snapshots: 6, points_rows: 6, coin_rows: 6, converted_total: 132 });

    await seedUser('unew', 2500);
    await runB();
    await runB();
    expect(await user('unew')).toMatchObject({ coinsBalance: 0, pointsConvertedBalance: 3 });
    expect(await counts()).toEqual({ snapshots: 7, points_rows: 7, coin_rows: 7, converted_total: 135 });
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
  });

  it('T2: user đã quy đổi lại có xu mới đúng bằng số cũ → chạy lại KHÔNG cộng điểm lần hai', async () => {
    await exec(`UPDATE ${SCHEMA}.users SET "coinsBalance" = 1000 WHERE "id" = 'u1000'`);
    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType")
                VALUES ('u1000_again', 'u1000', 1000, 'SEED', 'TEST')`);

    await runB();

    expect(await user('u1000')).toMatchObject({ coinsBalance: 1000, pointsConvertedBalance: 1 });
    expect(await counts()).toEqual({ snapshots: 7, points_rows: 7, coin_rows: 7, converted_total: 135 });
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });

    // Dọn để các ca sau làm việc trên dữ liệu đã quy đổi sạch.
    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType")
                VALUES ('u1000_again_undo', 'u1000', -1000, 'SEED', 'TEST')`);
    await exec(`UPDATE ${SCHEMA}.users SET "coinsBalance" = 0 WHERE "id" = 'u1000'`);
  });

  it('T3: sổ xu lệch hoặc số dư âm → RAISE, không ghi gì; đối soát xong chạy lại thì chỉ user đó được quy đổi', async () => {
    const before = await counts();

    await seedUser('udrift', 700, 0, []);
    await expect(runB()).rejects.toThrow(/1 user có coinsBalance khác SUM\(coin_transactions\.delta\)/);
    expect(await counts()).toEqual(before);
    expect(await user('udrift')).toMatchObject({ coinsBalance: 700, pointsConvertedBalance: 0 });

    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType")
                VALUES ('udrift_fix', 'udrift', 700, 'SEED', 'TEST')`);
    await seedUser('uneg', -5);
    await expect(runB()).rejects.toThrow(/1 user có coinsBalance âm/);
    expect(await counts()).toEqual(before);

    await exec(`INSERT INTO ${SCHEMA}.coin_transactions ("id", "userId", "delta", "reason", "refType")
                VALUES ('uneg_fix', 'uneg', 5, 'SEED', 'TEST')`);
    await exec(`UPDATE ${SCHEMA}.users SET "coinsBalance" = 0 WHERE "id" = 'uneg'`);
    await runB();

    expect(await user('udrift')).toMatchObject({ coinsBalance: 0, pointsConvertedBalance: 1 });
    expect(await user('uneg')).toMatchObject({ coinsBalance: 0, pointsConvertedBalance: 0 });
    const [snap] = await q<{ roundingVnd: number }>(`SELECT "roundingVnd" FROM ${SCHEMA}.xu_points_conversions WHERE "userId" = 'udrift'`);
    expect(snap!.roundingVnd).toBe(300);
    expect(await counts()).toEqual({ snapshots: 8, points_rows: 8, coin_rows: 8, converted_total: 136 });
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
  });

  it('CHECK DB: dòng CONVERTED có hạn và số dư quy đổi âm bị từ chối', async () => {
    await expect(
      exec(`INSERT INTO ${SCHEMA}.points_transactions ("id", "userId", "delta", "reason", "lot", "expiresAt")
            VALUES ('bad_exp', 'u1', 1, 'X', 'CONVERTED', now())`),
    ).rejects.toThrow(/points_transactions_converted_no_expiry/);
    await expect(exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = -1 WHERE "id" = 'u1'`)).rejects.toThrow(
      /users_points_converted_nonneg/,
    );
  });

  /** Ảnh chụp cái mà hoàn tác có thể đổi: số dư hai ví và số dòng hoàn tác ở hai sổ. */
  async function rollbackFootprint() {
    const users = await q<U>(`SELECT "id", "coinsBalance", "pointsBalance", "pointsConvertedBalance" FROM ${SCHEMA}.users ORDER BY "id"`);
    const [rows] = await q<{ p: number; c: number }>(`
      SELECT (SELECT count(*)::int FROM ${SCHEMA}.points_transactions WHERE "refType" = 'XU_MIGRATION_ROLLBACK') AS p,
             (SELECT count(*)::int FROM ${SCHEMA}.coin_transactions WHERE "refType" = 'XU_MIGRATION_ROLLBACK') AS c`);
    return { users, rows };
  }

  it('T21 (review A1): hoàn tác TỪ CHỐI khi lô quy đổi của một khách đã được gộp phiên sang user khác', async () => {
    // mergeGuestInto chuyển dòng sổ + số dư của khách sang target, refId vẫn là id khách. Hoàn tác theo bảng
    // chụp sẽ thấy khách số dư 0 (không trả xu) và target giữ điểm thừa mà code cũ không đọc được.
    const moveGuest = async (guest: string, from: string, to: string, pts: number) => {
      await exec(`UPDATE ${SCHEMA}.points_transactions SET "userId" = '${to}' WHERE "id" = 'ptx_xu2pts_${guest}'`);
      await exec(`UPDATE ${SCHEMA}.coin_transactions SET "userId" = '${to}' WHERE "id" IN ('seed_c_${guest}_0', 'ctx_xu2pts_${guest}')`);
      await exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = "pointsConvertedBalance" - ${pts} WHERE "id" = '${from}'`);
      await exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = "pointsConvertedBalance" + ${pts} WHERE "id" = '${to}'`);
    };
    await moveGuest('u1001', 'u1001', 'u999', 2);
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
    const before = await rollbackFootprint();

    await expect(runRollback()).rejects.toThrow(/dòng cộng vào lô quy đổi không phải dòng quy đổi gốc/);
    expect(await rollbackFootprint()).toEqual(before);

    await moveGuest('u1001', 'u999', 'u1001', 2); // bỏ gộp để các ca sau dùng dữ liệu sạch
  });

  it('T21 (review A1): hoàn tác TỪ CHỐI khi lô quy đổi nhận điểm không qua quy đổi (hoàn đơn xu cũ)', async () => {
    await exec(`INSERT INTO ${SCHEMA}.points_transactions ("id", "userId", "delta", "reason", "refType", "refId", "lot")
                VALUES ('it_refund_xu', 'u1000', 5, 'ORDER_REFUND_XU:IT', 'ORDER', 'o_legacy_xu', 'CONVERTED')`);
    await exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = "pointsConvertedBalance" + 5 WHERE "id" = 'u1000'`);
    const before = await rollbackFootprint();

    await expect(runRollback()).rejects.toThrow(/dòng cộng vào lô quy đổi không phải dòng quy đổi gốc/);
    expect(await rollbackFootprint()).toEqual(before);

    await exec(`DELETE FROM ${SCHEMA}.points_transactions WHERE "id" = 'it_refund_xu'`);
    await exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = "pointsConvertedBalance" - 5 WHERE "id" = 'u1000'`);
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
  });

  it('T21: hoàn tác trả đúng coinsBefore khi lô còn nguyên, lô đã tiêu một phần trả phần còn lại; chạy 2 lần không nhân đôi', async () => {
    // u123456 đã tiêu 100/124 điểm quy đổi (dòng tiêu lô CONVERTED, không qua đơn).
    await exec(`INSERT INTO ${SCHEMA}.points_transactions ("id", "userId", "delta", "reason", "refType", "lot")
                VALUES ('u123456_spend', 'u123456', -100, 'GAME_BUY_TREE:IT', 'GAME', 'CONVERTED')`);
    await exec(`UPDATE ${SCHEMA}.users SET "pointsConvertedBalance" = "pointsConvertedBalance" - 100 WHERE "id" = 'u123456'`);

    await runRollback();
    await runRollback();

    const coins: Record<string, number> = {};
    const converted: Record<string, number> = {};
    for (const id of ['u0', 'u1', 'u999', 'u1000', 'u1001', 'u123456', 'upts', 'unew', 'udrift', 'uneg']) {
      const u = await user(id);
      coins[id] = u.coinsBalance;
      converted[id] = u.pointsConvertedBalance;
    }
    expect(coins).toEqual({
      u0: 0, u1: 1, u999: 999, u1000: 1000, u1001: 1001, u123456: 24_000, upts: 3000, unew: 2500, udrift: 700, uneg: 0,
    });
    expect(Object.values(converted).every((v) => v === 0)).toBe(true);
    expect((await user('upts')).pointsBalance).toBe(50);

    const [rb] = await q<{ p: number; c: number }>(`
      SELECT (SELECT count(*)::int FROM ${SCHEMA}.points_transactions WHERE "refType" = 'XU_MIGRATION_ROLLBACK') AS p,
             (SELECT count(*)::int FROM ${SCHEMA}.coin_transactions WHERE "refType" = 'XU_MIGRATION_ROLLBACK') AS c`);
    expect(rb).toEqual({ p: 8, c: 8 });
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
    // Bảng chụp và dòng quy đổi gốc vẫn còn (không xoá gì).
    expect((await counts()).snapshots).toBe(8);
  });

  it('T21: hoàn tác từ chối khi đã có đơn tiêu điểm quy đổi', async () => {
    await exec(`INSERT INTO ${SCHEMA}.orders ("id", "pointsUsedConverted") VALUES ('o_spent', 3)`);
    await expect(runRollback()).rejects.toThrow(/1 đơn đã tiêu điểm quy đổi/);
  });

  it('số dư xu sát trần INTEGER (2.147.483.647) quy đổi và hoàn tác được, không tràn số', async () => {
    await exec(`DELETE FROM ${SCHEMA}.orders WHERE "id" = 'o_spent'`);
    await seedUser('ubig', 2_147_483_647);

    await runB();

    expect(await user('ubig')).toMatchObject({ coinsBalance: 0, pointsConvertedBalance: 2_147_484 });
    const [snap] = await q<{ roundingVnd: number }>(`SELECT "roundingVnd" FROM ${SCHEMA}.xu_points_conversions WHERE "userId" = 'ubig'`);
    expect(snap!.roundingVnd).toBe(353);
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });

    await runRollback();

    expect(await user('ubig')).toMatchObject({ coinsBalance: 2_147_483_647, pointsConvertedBalance: 0 });
    expect(await invariants()).toEqual({ converted_drift: 0, standard_drift: 0, coin_drift: 0 });
  });
});
