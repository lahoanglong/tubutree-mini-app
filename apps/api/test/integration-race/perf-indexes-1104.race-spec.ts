import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { DataRetentionService } from '../../src/modules/data-retention/data-retention.service';
import { createUser, randCode } from './helpers';

type Captured = { query: string; params: string };

/**
 * Trên Postgres THẬT: câu SQL mà code sinh ra phải đi bằng index mới khi planner bị cấm quét tuần tự
 * (bảng test chỉ vài nghìn dòng nên planner tự chọn Seq Scan nếu không ép; ép để chứng minh index dùng được cho câu đó).
 */
describe('Index hiệu năng 2026-11-04 (real Postgres)', () => {
  const prefix = `itpx${randCode(6).toLowerCase()}`;
  const tables = ['notification_logs', 'points_transactions', 'pancake_webhook_events', 'gomdon_webhook_events', 'oa_inbound_messages', 'analytics_events', 'refresh_tokens'];
  let prisma: PrismaClient;
  let captured: Captured[] = [];
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    (prisma as unknown as { $on: (e: 'query', cb: (q: Captured) => void) => void }).$on('query', (q) => captured.push(q));
    await prisma.$connect();
    userId = (await createUser(prisma as unknown as PrismaService)).id;
    const old = "now() - interval '400 days'";
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_logs (id, "userId", "templateCode", channel, payload, status, error, "sentAt")
       SELECT '${prefix}-n'||g, 'u'||(g % 50), 'T', CASE WHEN g % 10 = 0 THEN 'ZNS' ELSE 'INAPP' END, '{}'::jsonb,
              CASE WHEN g % 3 = 0 THEN 'FAILED' ELSE 'SENT' END, 'e'||(g % 4), now() - (g || ' minutes')::interval
       FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", "createdAt")
       SELECT '${prefix}-p'||g, '${userId}', 1, 'R'||g, CASE WHEN g % 2 = 0 THEN 'ORDER' ELSE 'OTHER' END, 'ref'||g, now()
       FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO pancake_webhook_events (id, "eventType", "rawPayload", status, "receivedAt")
       SELECT '${prefix}-pw'||g, 'x', '{}'::jsonb, 'PROCESSED', ${old} + (g || ' seconds')::interval FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO gomdon_webhook_events (id, "dedupeKey", "rawPayload", status, "receivedAt")
       SELECT '${prefix}-gw'||g, '${prefix}-gk'||g, '{}'::jsonb, 'PROCESSED', ${old} + (g || ' seconds')::interval FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO oa_inbound_messages (id, "zaloUserId", "rawPayload", status, "createdAt")
       SELECT '${prefix}-oa'||g, 'z'||g, '{}'::jsonb, 'DONE', ${old} + (g || ' seconds')::interval FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO analytics_events (id, "eventId", "eventName", "occurredAt", platform, props, "receivedAt")
       SELECT '${prefix}-ae'||g, '${prefix}-ev'||g, 'e', ${old}, 'web', '{}'::jsonb, ${old} + (g || ' seconds')::interval FROM generate_series(1, 3000) g`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO refresh_tokens (id, "userId", "tokenHash", "expiresAt", "createdAt")
       SELECT '${prefix}-rt'||g, '${userId}', '${prefix}-th'||g, now() + (g || ' hours')::interval - interval '500 days', now()
       FROM generate_series(1, 3000) g`,
    );
    for (const t of tables) await prisma.$executeRawUnsafe(`ANALYZE ${t}`);
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE "id" LIKE '${prefix}-%'`);
    await prisma.$disconnect();
  });

  // Prisma báo tham số dạng chuỗi JSON; nhúng thẳng làm literal có kiểu để EXPLAIN chạy được mà không cần bind.
  function inline(q: Captured): string {
    const params = JSON.parse(q.params) as unknown[];
    let sql = q.query;
    for (let i = params.length; i >= 1; i--) {
      const v = params[i - 1];
      const lit =
        typeof v === 'number'
          ? String(v)
          : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
            ? `'${v}'::timestamp`
            : `'${String(v).replace(/'/g, "''")}'`;
      sql = sql.split(`$${i}`).join(lit);
    }
    return sql;
  }

  async function planOf(q: Captured): Promise<string> {
    const sql = inline(q);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': unknown }[]>(`EXPLAIN (FORMAT JSON) ${sql}`);
      return JSON.stringify(rows[0]['QUERY PLAN']);
    });
  }

  it('D4: đếm và gom nhóm ZNS FAILED 24 giờ đi bằng partial index notification_logs', async () => {
    const where = { channel: 'ZNS', status: 'FAILED', sentAt: { gte: new Date(Date.now() - 86_400_000) } };
    captured = [];
    await prisma.notificationLog.count({ where });
    await prisma.notificationLog.groupBy({ by: ['error'], where, _count: { _all: true }, orderBy: { _count: { error: 'desc' } }, take: 1 });
    const qs = captured.filter((q) => /FROM "(public"\.")?notification_logs"/.test(q.query));
    expect(qs.length).toBeGreaterThanOrEqual(2);
    // Từ gói hg có thêm index thường (channel, status, sentAt) cũng khớp đúng điều kiện này; planner chọn cái nào tuỳ thống kê. Điều cần giữ: đi index, không quét bảng.
    for (const q of qs) expect(await planOf(q)).toMatch(/notification_logs_zns_failed_sentAt_idx|notification_logs_channel_status_sentAt_idx/);
  });

  it('D4: lọc khoảng sentAt (trang mẫu tin 30 ngày) dùng index sentAt', async () => {
    captured = [];
    await prisma.notificationLog.count({ where: { sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
    const q = captured.find((c) => /FROM "(public"\.")?notification_logs"/.test(c.query))!;
    expect(await planOf(q)).toMatch(/notification_logs_sentAt_idx/);
  });

  it('D5: dò dòng điểm của đơn theo refId + refType=ORDER dùng partial index', async () => {
    captured = [];
    await prisma.pointsTransaction.findFirst({ where: { reason: 'ORDER_DELIVERED:X', refType: 'ORDER', refId: `${prefix}-ord` }, select: { userId: true } });
    const q = captured.find((c) => /FROM "(public"\.")?points_transactions"/.test(c.query))!;
    expect(q.query).toMatch(/"refType"/);
    expect(await planOf(q)).toMatch(/points_transactions_order_refId_idx/);
  });

  it('D10: các lô xoá của data-retention đi bằng index thời gian', async () => {
    const config = { get: async (_k: string, d: unknown) => d } as never;
    const svc = new DataRetentionService(prisma as unknown as PrismaService, config);
    captured = [];
    await svc.runAll({ now: new Date(), batchSize: 100, pauseMs: 0, maxRunMs: 5_000 });
    const expected: Record<string, RegExp> = {
      notification_logs: /notification_logs_sentAt_idx/,
      pancake_webhook_events: /pancake_webhook_events_receivedAt_idx/,
      gomdon_webhook_events: /gomdon_webhook_events_receivedAt_idx/,
      oa_inbound_messages: /oa_inbound_messages_createdAt_idx/,
      analytics_events: /analytics_events_receivedAt_idx/,
      refresh_tokens: /refresh_tokens_expiresAt_idx/,
    };
    for (const [table, re] of Object.entries(expected)) {
      const q = captured.find((c) => new RegExp(`^\\s*DELETE FROM "(public"\\.")?${table}"`).test(c.query));
      expect(q).toBeDefined();
      expect(await planOf(q!)).toMatch(re);
    }
  });
});
