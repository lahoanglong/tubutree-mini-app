/**
 * Kiểm mọi partial unique index (CREATE UNIQUE INDEX ... WHERE ...) khai trong migrations/ có mặt
 * trong DB. Prisma schema không biểu diễn được index có điều kiện WHERE, nên chúng chỉ sống trong
 * migration SQL: `prisma db push` dựng DB từ schema sẽ thiếu (hoặc xoá) chúng, và các khoá chống
 * cộng tiền/điểm/xu trùng biến mất mà không có lỗi nào. Chạy sau `prisma migrate deploy`:
 *
 *   DATABASE_URL=... npx tsx prisma/check-partial-indexes.ts
 *
 * Thoát mã 1 và liệt kê tên index thiếu nếu có.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Sàn tối thiểu: các khoá chống cộng tiền/điểm/xu/đơn trùng đã được kiểm chứng ở audit 2026-10
 * (C-109). Giữ danh sách cứng để nếu bộ đọc SQL bên dưới hỏng (không tìm ra gì) thì vẫn bắt được.
 */
export const KNOWN_PARTIAL_UNIQUE_INDEXES = [
  'attendance_sessions_open_staff_key',
  'coin_transactions_community_reason_key',
  'coin_transactions_convert_ref_key',
  'coin_transactions_quest_unique',
  'coin_transactions_referral_unique',
  'coin_transactions_xu_migration_key',
  'coupon_redemptions_couponId_orderId_notnull',
  'dealer_applications_pending_user_key',
  'points_transactions_checkin_day_key',
  'points_transactions_community_reason_key',
  'points_transactions_converted_refund_unique',
  'points_transactions_delivered_unique',
  'points_transactions_pos_ref_key',
  'points_transactions_quest_unique',
  'points_transactions_referral_unique',
  'points_transactions_reverse_unique',
  'points_transactions_xu_migration_key',
  'return_requests_open_order_key',
  'role_grants_active_phone_role_key',
  'subscriptions_user_variation_address_open_key',
] as const;

const IDENT = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const CREATE_PARTIAL_UNIQUE = new RegExp(
  String.raw`^CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s+ON\s[\s\S]*\bWHERE\b`,
  'i',
);
const DROP_INDEX = new RegExp(String.raw`^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?${IDENT}`, 'i');
const RENAME_INDEX = new RegExp(
  String.raw`^ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?${IDENT}\s+RENAME\s+TO\s+${IDENT}`,
  'i',
);

/** Tên partial unique index còn hiệu lực sau khi áp lần lượt các migration SQL (theo thứ tự). */
export function partialUniqueIndexesFromSql(migrationSqls: string[]): Set<string> {
  const names = new Set<string>();
  for (const sql of migrationSqls) {
    const statements = sql
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n')
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const stmt of statements) {
      const created = CREATE_PARTIAL_UNIQUE.exec(stmt);
      if (created) {
        names.add(created[1]!);
        continue;
      }
      const dropped = DROP_INDEX.exec(stmt);
      if (dropped) {
        names.delete(dropped[1]!);
        continue;
      }
      const renamed = RENAME_INDEX.exec(stmt);
      if (renamed && names.delete(renamed[1]!)) names.add(renamed[2]!);
    }
  }
  return names;
}

export function readMigrationSqls(migrationsDir = join(__dirname, 'migrations')): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => join(migrationsDir, name, 'migration.sql'))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'));
}

export function expectedPartialUniqueIndexes(migrationSqls = readMigrationSqls()): string[] {
  return [...new Set([...KNOWN_PARTIAL_UNIQUE_INDEXES, ...partialUniqueIndexesFromSql(migrationSqls)])].sort();
}

export interface PartialIndexReport {
  expected: string[];
  present: string[];
  missing: string[];
  /** Có trong DB nhưng không thấy trong migrations (tạo tay ngoài migration — cần đưa vào migration). */
  undeclared: string[];
}

export async function checkPartialUniqueIndexes(
  db: Pick<PrismaClient, '$queryRaw'>,
  expected = expectedPartialUniqueIndexes(),
): Promise<PartialIndexReport> {
  const rows = await db.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '% WHERE %'`;
  const present = rows.map((r) => r.indexname).sort();
  const presentSet = new Set(present);
  const expectedSet = new Set(expected);
  return {
    expected,
    present,
    missing: expected.filter((n) => !presentSet.has(n)),
    undeclared: present.filter((n) => !expectedSet.has(n)),
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await checkPartialUniqueIndexes(prisma);
    console.log(`Partial unique index: mong đợi ${report.expected.length}, có trong DB ${report.present.length}.`);
    if (report.undeclared.length > 0) {
      console.warn(`Có trong DB nhưng không thấy trong migrations: ${report.undeclared.join(', ')}`);
    }
    if (report.missing.length > 0) {
      console.error(
        `THIẾU ${report.missing.length} partial unique index (DB dựng bằng db push hoặc migration chưa áp?): ${report.missing.join(', ')}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
