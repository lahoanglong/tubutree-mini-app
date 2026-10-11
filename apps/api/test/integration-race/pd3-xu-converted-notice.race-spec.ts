import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn } from './sql-script';

/**
 * PD-3 L5 (OQ-10): báo khách có xu được quy sang Điểm Xanh. Migration chỉ THÊM mẫu tin XU_CONVERTED và một
 * thông báo trong app cho mỗi user ở bảng chụp xu_points_conversions (migration B). Chạy CHÍNH file
 * migration.sql trên schema nháp dựng bằng LIKE public.* (không đụng bảng public mà race spec khác dùng).
 */
const SCHEMA = 'pd3_notice_mig';
const MIGRATION = readApiSql('prisma/migrations/20261012160000_pd3_xu_converted_notice/migration.sql');

describe('PD-3 migration báo quy đổi xu → Điểm Xanh (real Postgres)', () => {
  const prisma = new PrismaClient();
  const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);
  const q = <T>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params);
  const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);

  /** Một dòng bảng chụp như migration B ghi: coinsBefore xu → pointsGranted điểm. */
  async function snapshot(userId: string, coinsBefore: number, pointsGranted: number) {
    await exec(
      `INSERT INTO ${SCHEMA}.xu_points_conversions
         ("userId", "coinsBefore", "pointsBefore", "convertedBefore", "pointsGranted", "roundingVnd", "pointsTxId", "coinTxId")
       VALUES ($1, $2, 0, 0, $3, $4, $5, $6)`,
      userId,
      coinsBefore,
      pointsGranted,
      pointsGranted * 1000 - coinsBefore,
      `ptx_${userId}`,
      `ctx_${userId}`,
    );
  }
  const logs = () =>
    q<{ id: string; userId: string; templateCode: string; channel: string; status: string; payload: { body: string; data: Record<string, string> } }>(
      `SELECT "id", "userId", "templateCode", "channel", "status", "payload" FROM ${SCHEMA}.notification_logs ORDER BY "userId"`,
    );
  const template = () =>
    q<{ id: string; code: string; channel: string; bodyTemplate: string }>(
      `SELECT "id", "code", "channel", "bodyTemplate" FROM ${SCHEMA}.notification_templates WHERE "code" = 'XU_CONVERTED'`,
    );

  beforeEach(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ['xu_points_conversions', 'notification_templates', 'notification_logs']) {
      await exec(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('chưa user nào được quy đổi: chỉ thêm mẫu tin, không có thông báo nào', async () => {
    await run();
    expect(await template()).toEqual([
      {
        id: 'nt-xu-converted',
        code: 'XU_CONVERTED',
        channel: 'INAPP',
        bodyTemplate: '{{xu}} xu cũ của bạn đã thành {{points}} Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.',
      },
    ]);
    expect(await logs()).toEqual([]);
  });

  it('mỗi user trong bảng chụp nhận đúng một thông báo trong app với số xu và số điểm của chính họ', async () => {
    await snapshot('u1', 1, 1);
    await snapshot('u1000', 1000, 1);
    await snapshot('u123456', 123_456, 124);
    await run();

    const rows = await logs();
    expect(rows.map((r) => [r.userId, r.templateCode, r.channel, r.status])).toEqual([
      ['u1', 'XU_CONVERTED', 'INAPP', 'SENT'],
      ['u1000', 'XU_CONVERTED', 'INAPP', 'SENT'],
      ['u123456', 'XU_CONVERTED', 'INAPP', 'SENT'],
    ]);
    // Dấu chấm ngăn nghìn như mọi màn tiếng Việt (123.456), không dấu phẩy và không để sót {{biến}}.
    expect(rows.map((r) => r.payload.body)).toEqual([
      '1 xu cũ của bạn đã thành 1 Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.',
      '1.000 xu cũ của bạn đã thành 1 Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.',
      '123.456 xu cũ của bạn đã thành 124 Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.',
    ]);
    expect(rows[2]!.payload.data).toEqual({ xu: '123.456', points: '124' });
  });

  it('chạy lại không nhân đôi thông báo và không đè trạng thái đã đọc; user quy đổi sau đó nhận đúng một thông báo', async () => {
    await snapshot('u1', 1, 1);
    await run();
    await exec(`UPDATE ${SCHEMA}.notification_logs SET "status" = 'READ' WHERE "userId" = 'u1'`);

    await run();
    await snapshot('unew', 2500, 3);
    await run();
    await run();

    const rows = await logs();
    expect(rows.map((r) => [r.userId, r.status])).toEqual([
      ['u1', 'READ'],
      ['unew', 'SENT'],
    ]);
    expect(rows[1]!.payload.body).toBe('2.500 xu cũ của bạn đã thành 3 Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.');
  });

  it('mẫu tin admin đã sửa được giữ nguyên (không ghi đè) và thông báo dựng theo lời admin đang dùng', async () => {
    await exec(
      `INSERT INTO ${SCHEMA}.notification_templates ("id", "code", "channel", "bodyTemplate")
       VALUES ('nt-xu-converted', 'XU_CONVERTED', 'INAPP', 'Admin sửa: {{xu}} xu cũ thành {{points}} Điểm Xanh.')`,
    );
    await snapshot('u1001', 1001, 2);
    await run();

    expect((await template())[0]!.bodyTemplate).toBe('Admin sửa: {{xu}} xu cũ thành {{points}} Điểm Xanh.');
    expect((await logs())[0]!.payload.body).toBe('Admin sửa: 1.001 xu cũ thành 2 Điểm Xanh.');
  });
});
