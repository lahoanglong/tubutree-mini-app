import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { DataRetentionService, RETENTION_LOCK_KEY } from '../../src/modules/data-retention/data-retention.service';
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
    // 3000 dòng trên chỉ trải 50 giờ gần nhất, nên `sentAt >= now-30 ngày` chọn ~100% bảng: với seqscan bị tắt, mọi index đều phải đọc hết và planner
    // chọn theo kích thước/độ phình index (đỏ ngẫu nhiên trên DB mới: nó chọn notification_logs_userId_sentAt_idx). Thêm dòng cũ 31-170 ngày (dưới mốc
    // retention 180 ngày nên D10 không xoá) để khoảng 30 ngày chỉ chọn ~13% bảng; đó mới là tính chọn lọc mà index sentAt phục vụ.
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_logs (id, "userId", "templateCode", channel, payload, status, error, "sentAt")
       SELECT '${prefix}-o'||g, 'u'||(g % 50), 'T', CASE WHEN g % 10 = 0 THEN 'ZNS' ELSE 'INAPP' END, '{}'::jsonb,
              CASE WHEN g % 3 = 0 THEN 'FAILED' ELSE 'SENT' END, 'e'||(g % 4), now() - ((31 + g % 140) * 86400 + g % 86400 || ' seconds')::interval
       FROM generate_series(1, 20000) g`,
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

  /**
   * Sự kiện `query` của Prisma (engine thư viện) do phía native gọi lại qua hàng đợi sự kiện của Node, độc lập với việc promise của truy vấn resolve:
   * không có gì bảo đảm câu cuối đã tới `captured` ngay sau `await`. Chờ tới khi có câu khớp (tối đa 3 giây) thay vì đọc ngay; khi không thấy
   * thì lỗi in kèm danh sách câu đã bắt để biết do thiếu sự kiện hay do code không sinh câu đó.
   */
  async function capturedMatching(re: RegExp, label: string): Promise<Captured> {
    const found = () => captured.find((c) => re.test(c.query));
    for (let waited = 0; !found() && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    const hit = found();
    if (!hit) {
      const seen = captured.map((c) => c.query.slice(0, 90).replace(/\s+/g, ' '));
      throw new Error(`${label}: không bắt được câu khớp ${re}; captured.length=${captured.length}; đã bắt: ${JSON.stringify(seen)}`);
    }
    return hit;
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
    // Cả hai truy vấn (count và groupBy) đều phải tới: chờ cho đến khi đủ hai câu thay vì đọc ngay sau await.
    for (let waited = 0; captured.filter((q) => /FROM "(public"\.")?notification_logs"/.test(q.query)).length < 2 && waited < 3000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const qs = captured.filter((q) => /FROM "(public"\.")?notification_logs"/.test(q.query));
    if (qs.length < 2) throw new Error(`D4 ZNS FAILED: chỉ bắt được ${qs.length}/2 câu; captured.length=${captured.length}; đã bắt: ${JSON.stringify(captured.map((c) => c.query.slice(0, 90)))}`);
    // Từ gói hg có thêm index thường (channel, status, sentAt) cũng khớp đúng điều kiện này; planner chọn cái nào tuỳ thống kê. Điều cần giữ: đi index, không quét bảng.
    for (const q of qs) expect(await planOf(q)).toMatch(/notification_logs_zns_failed_sentAt_idx|notification_logs_channel_status_sentAt_idx/);
  });

  it('D4: lọc khoảng sentAt (trang mẫu tin 30 ngày) dùng index sentAt', async () => {
    captured = [];
    await prisma.notificationLog.count({ where: { sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
    const q = await capturedMatching(/FROM "(public"\.")?notification_logs"/, 'D4 khoảng sentAt');
    expect(await planOf(q)).toMatch(/notification_logs_sentAt_idx/);
  });

  it('D5: dò dòng điểm của đơn theo refId + refType=ORDER dùng partial index', async () => {
    captured = [];
    await prisma.pointsTransaction.findFirst({ where: { reason: 'ORDER_DELIVERED:X', refType: 'ORDER', refId: `${prefix}-ord` }, select: { userId: true } });
    const q = await capturedMatching(/FROM "(public"\.")?points_transactions"/, 'D5');
    expect(q.query).toMatch(/"refType"/);
    expect(await planOf(q)).toMatch(/points_transactions_order_refId_idx/);
  });

  it('D10: các lô xoá của data-retention đi bằng index thời gian', async () => {
    const config = { get: async (_k: string, d: unknown) => d } as never;
    const svc = new DataRetentionService(prisma as unknown as PrismaService, config);
    // runAll giành khoá lượt chạy `run:cron:data-retention.cleanup` trong cron_leases (ttl 2 phút): một lượt khác còn giữ khoá (spec trước nhả
    // lỗi, tiến trình khác trên cùng DB) thì runAll trả LOCKED, không có câu DELETE nào để EXPLAIN và ca đỏ ngẫu nhiên. DB race là DB riêng
    // chạy tuần tự nên xoá dòng khoá của chính key này là an toàn; kiểm thêm kết quả để lỗi (nếu còn) nói đúng nguyên nhân.
    await prisma.$executeRawUnsafe(`DELETE FROM cron_leases WHERE name = 'run:${RETENTION_LOCK_KEY}'`);
    captured = [];
    const result = await svc.runAll({ now: new Date(), batchSize: 100, pauseMs: 0, maxRunMs: 5_000 });
    expect(result).not.toHaveProperty('skipped');
    const expected: Record<string, RegExp> = {
      notification_logs: /notification_logs_sentAt_idx/,
      pancake_webhook_events: /pancake_webhook_events_receivedAt_idx/,
      gomdon_webhook_events: /gomdon_webhook_events_receivedAt_idx/,
      oa_inbound_messages: /oa_inbound_messages_createdAt_idx/,
      analytics_events: /analytics_events_receivedAt_idx/,
      refresh_tokens: /refresh_tokens_expiresAt_idx/,
    };
    for (const [table, re] of Object.entries(expected)) {
      const batchSql = new RegExp(`^\\s*DELETE FROM "(public"\\.")?${table}"`);
      const caught = () => captured.filter((c) => /^\s*DELETE FROM/.test(c.query)).map((c) => c.query.slice(0, 60).replace(/\s+/g, ' '));
      const q = await capturedMatching(batchSql, `D10 bảng ${table}; result=${JSON.stringify(result)}; câu xoá đã bắt=${JSON.stringify(caught())}`);
      expect(await planOf(q)).toMatch(re);
    }
  });
});
