import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn, splitSqlStatements } from './sql-script';

/**
 * PD-3 migration A (kiểu PointsLot, cột lot/pointsConvertedBalance/pointsUsedConverted/rewardPoints, hai CHECK, các
 * partial unique index) phải chạy lại được bằng tay trên DB ĐÃ áp A: gặp lỗi giữa chừng thì người trực chạy lại
 * file sau `migrate resolve --rolled-back`, hoặc kiểm bằng psql trên bản sao. Chạy lại không được lỗi và không được
 * đổi gì trong catalog.
 *
 * Chạy trên schema public của DB test (nơi `migrate deploy` đã áp A). Race spec chạy --runInBand nên không tranh khoá
 * với spec khác; câu ALTER chỉ giữ khoá ngắn và không đổi dữ liệu.
 */
const MIGRATION_A = readApiSql('prisma/migrations/20261012100000_pd3_points_lot_schema/migration.sql');

describe('PD-3 migration A chạy lại được trên DB đã áp (real Postgres)', () => {
  const prisma = new PrismaClient();
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const runA = () => runSqlScriptIn(prisma, 'public', MIGRATION_A);

  /** Dấu vết catalog mà A tạo ra; hai lần chụp phải bằng nhau. */
  async function catalogOfA() {
    const constraints = await q<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('points_transactions_converted_no_expiry', 'users_points_converted_nonneg') ORDER BY conname`,
    );
    const columns = await q<{ table_name: string; column_name: string; data_type: string; column_default: string | null; is_nullable: string }>(
      `SELECT table_name, column_name, udt_name AS data_type, column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND (
          (table_name = 'points_transactions' AND column_name = 'lot') OR
          (table_name = 'users' AND column_name = 'pointsConvertedBalance') OR
          (table_name = 'orders' AND column_name = 'pointsUsedConverted') OR
          (table_name IN ('community_events', 'ctv_milestone_claims') AND column_name = 'rewardPoints'))
        ORDER BY table_name, column_name`,
    );
    const enumValues = await q<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PointsLot' ORDER BY e.enumsortorder`,
    );
    const indexes = await q<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
         'points_transactions_xu_migration_key', 'coin_transactions_xu_migration_key', 'points_transactions_referral_unique',
         'points_transactions_community_reason_key', 'points_transactions_quest_unique', 'points_transactions_converted_refund_unique')
        ORDER BY indexname`,
    );
    return { constraints, columns, enumValues, indexes };
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('splitSqlStatements tách được file A có khối DO $$ ... $$', () => {
    const stmts = splitSqlStatements(MIGRATION_A);
    expect(stmts.length).toBeGreaterThan(10);
    for (const s of stmts.filter((x) => x.startsWith('DO'))) expect(s).toMatch(/END \$\$$/);
  });

  it('DB test đã có đủ vết của A trước khi chạy lại (điều kiện của ca)', async () => {
    const c = await catalogOfA();
    expect(c.constraints.map((x) => x.conname)).toEqual(['points_transactions_converted_no_expiry', 'users_points_converted_nonneg']);
    expect(c.columns).toHaveLength(5);
    expect(c.enumValues.map((x) => x.enumlabel)).toEqual(['STANDARD', 'CONVERTED']);
    expect(c.indexes).toHaveLength(6);
  });

  it('chạy lại A trên DB đã áp: không lỗi, catalog giữ nguyên, hai lần liền cũng không đổi', async () => {
    const before = await catalogOfA();
    await runA();
    expect(await catalogOfA()).toEqual(before);
    await runA();
    expect(await catalogOfA()).toEqual(before);
  });
});
