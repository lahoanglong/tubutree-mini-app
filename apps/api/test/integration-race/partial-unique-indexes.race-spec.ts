import { PrismaClient } from '@prisma/client';
import {
  KNOWN_PARTIAL_UNIQUE_INDEXES,
  checkPartialUniqueIndexes,
  expectedPartialUniqueIndexes,
  partialUniqueIndexesFromSql,
  readMigrationSqls,
} from '../../prisma/check-partial-indexes';

/**
 * C-109: các partial unique index chốt tiền chỉ sống trong migration SQL (Prisma schema không biểu
 * diễn được WHERE). DB này được dựng bằng `prisma migrate deploy` nên phải có đủ; một schema dựng
 * kiểu db push (bảng không kèm index điều kiện) thì bộ kiểm phải báo thiếu.
 */
describe('Partial unique indexes after migrate deploy (real Postgres)', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS pb1_partial_check CASCADE');
    await prisma.$disconnect();
  });

  it('parses every known money-locking partial unique index out of the migrations, and only partial ones', () => {
    const parsed = partialUniqueIndexesFromSql(readMigrationSqls());
    for (const name of KNOWN_PARTIAL_UNIQUE_INDEXES) expect(parsed).toContain(name);
    // Unique thường (không WHERE) mà ngay sau có comment chứa chữ WHERE không được tính nhầm.
    expect(parsed).not.toContain('reputation_events_userId_reason_refId_key');
    expect(parsed).not.toContain('ctv_milestone_claims_userId_milestoneId_monthKey_key');
  });

  it('parser follows DROP INDEX / ALTER INDEX RENAME across migrations', () => {
    const parsed = partialUniqueIndexesFromSql([
      'CREATE UNIQUE INDEX IF NOT EXISTS "a_key"\n  ON "t"("x") -- note; WHERE\r\n  WHERE "y" IS NULL;\r\nCREATE UNIQUE INDEX "b_key" ON "t"("z"); -- WHERE x',
      'CREATE UNIQUE INDEX "c_key" ON "t"("x") WHERE "s" = \'OPEN\';',
      'DROP INDEX IF EXISTS "c_key";\nALTER INDEX "a_key" RENAME TO "a2_key";',
    ]);
    expect([...parsed]).toEqual(['a2_key']);
  });

  it('a database built by migrate deploy has every expected partial unique index', async () => {
    const report = await checkPartialUniqueIndexes(prisma);
    console.log('[partial-unique] expected=%d present=%d missing=%j undeclared=%j', report.expected.length, report.present.length, report.missing, report.undeclared);
    expect(report.expected.length).toBeGreaterThanOrEqual(KNOWN_PARTIAL_UNIQUE_INDEXES.length);
    expect(report.missing).toEqual([]);
  });

  it('a schema whose tables lack the conditional indexes (what db push leaves behind) is reported as missing all of them', async () => {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS pb1_partial_check CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA pb1_partial_check');
    await prisma.$executeRawUnsafe(
      'CREATE TABLE pb1_partial_check.points_transactions (LIKE public.points_transactions INCLUDING DEFAULTS)',
    );
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path TO pb1_partial_check');
      return checkPartialUniqueIndexes(tx);
    });
    expect(report.present).toEqual([]);
    expect(report.missing).toEqual(expectedPartialUniqueIndexes());
  });
});
