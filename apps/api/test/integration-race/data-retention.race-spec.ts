import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DataRetentionService } from '../../src/modules/data-retention/data-retention.service';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Job dọn log theo lô (C-046) trên Postgres THẬT: dòng quá hạn bị xoá hết qua nhiều lô, dòng còn hạn giữ nguyên,
 * analytics_events chỉ xoá khi ngày đó đã có retention_daily_snapshot, chạy lại không xoá thêm, 2 job chạy đồng
 * thời thì chỉ một job làm việc.
 */
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const vnDay = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

describe('Data retention cleanup (real Postgres)', () => {
  let prisma: PrismaService;
  let svc: DataRetentionService;
  let userId: string;
  const tag = randCode(8);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    svc = new DataRetentionService(prisma, new SystemConfigService(prisma));
    userId = (await createUser(prisma)).id;
    for (const k of [
      'retention.analytics_events_days',
      'retention.notification_logs_days',
      'retention.webhook_events_days',
      'retention.refresh_sessions_days',
    ]) {
      await prisma.systemConfig.deleteMany({ where: { key: k } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function ids<T extends { id: string }>(rows: Promise<T[]>) {
    return new Set((await rows).map((r) => r.id));
  }

  it('xoá đúng dòng quá hạn theo lô, giữ dòng còn hạn, idempotent', async () => {
    const OLD = 12; // > 5 lô (batchSize 2) cho mỗi bảng

    // notification_logs: quá hạn 181 ngày, còn hạn 179 ngày
    const nOld = await Promise.all(
      Array.from({ length: OLD }, () =>
        prisma.notificationLog.create({ data: { userId, templateCode: tag, channel: 'INAPP', payload: {}, status: 'SENT', sentAt: ago(181) } }),
      ),
    );
    const nNew = await prisma.notificationLog.create({
      data: { userId, templateCode: tag, channel: 'INAPP', payload: {}, status: 'SENT', sentAt: ago(179) },
    });

    // webhook events: 91 ngày vs 89 ngày
    const pOld = await Promise.all(
      Array.from({ length: OLD }, () =>
        prisma.pancakeWebhookEvent.create({ data: { eventType: tag, rawPayload: {}, status: 'PROCESSED', receivedAt: ago(91) } }),
      ),
    );
    const pNew = await prisma.pancakeWebhookEvent.create({ data: { eventType: tag, rawPayload: {}, status: 'RECEIVED', receivedAt: ago(89) } });
    const gOld = await prisma.gomdonWebhookEvent.create({
      data: { dedupeKey: `${tag}-old`, rawPayload: {}, status: 'PROCESSED', receivedAt: ago(91) },
    });
    const gNew = await prisma.gomdonWebhookEvent.create({
      data: { dedupeKey: `${tag}-new`, rawPayload: {}, status: 'RECEIVED', receivedAt: ago(89) },
    });
    const oOld = await prisma.oaInboundMessage.create({ data: { zaloUserId: tag, rawPayload: {}, createdAt: ago(91) } });
    const oNew = await prisma.oaInboundMessage.create({ data: { zaloUserId: tag, rawPayload: {}, createdAt: ago(89) } });

    // refresh_tokens: thu hồi 31 ngày trước (xoá), hết hạn 31 ngày trước (xoá), thu hồi 29 ngày trước (giữ),
    // còn hạn chưa thu hồi (giữ), hết hạn 29 ngày trước (giữ), thu hồi 31 ngày trước nhưng... (xoá)
    const tok = (suffix: string, data: { expiresAt: Date; revokedAt?: Date }) =>
      prisma.refreshToken.create({ data: { userId, tokenHash: `${tag}-${suffix}`, ...data } });
    const tRevokedOld = await tok('rev-old', { expiresAt: ago(-10), revokedAt: ago(31) });
    const tExpiredOld = await tok('exp-old', { expiresAt: ago(31) });
    const tRevokedNew = await tok('rev-new', { expiresAt: ago(-10), revokedAt: ago(29) });
    const tExpiredNew = await tok('exp-new', { expiresAt: ago(29) });
    const tLive = await tok('live', { expiresAt: ago(-10) });

    // analytics_events: 400 ngày trước CÓ snapshot (xoá), 401 ngày trước KHÔNG có snapshot (giữ),
    // 300 ngày trước có snapshot nhưng còn hạn (giữ)
    const withSnap = ago(400);
    const noSnap = ago(401);
    const fresh = ago(300);
    for (const d of [withSnap, fresh]) {
      await prisma.retentionDailySnapshot.upsert({
        where: { date: new Date(vnDay(d)) },
        create: { date: new Date(vnDay(d)), newBuyers: 0, activeBuyers: 0, ordersCount: 0, ordersPerBuyerMtd: 0, dauProxyRefreshToken: 0 },
        update: {},
      });
    }
    await prisma.retentionDailySnapshot.deleteMany({ where: { date: new Date(vnDay(noSnap)) } });
    const ev = (suffix: string, at: Date) =>
      prisma.analyticsEvent.create({
        data: { eventId: `${tag}-${suffix}`, eventName: 'screen_view', occurredAt: at, receivedAt: at, platform: 'test', props: {} },
      });
    const aSnap = await Promise.all(Array.from({ length: OLD }, (_, i) => ev(`snap-${i}`, withSnap)));
    const aNoSnap = await ev('nosnap', noSnap);
    const aFresh = await ev('fresh', fresh);

    const run = () => svc.runAll({ batchSize: 2, pauseMs: 0 });
    const first = await run();
    expect(first).toMatchObject({ truncated: false });
    const deleted = (first as { deleted: Record<string, number> }).deleted;
    expect(deleted.notification_logs).toBeGreaterThanOrEqual(OLD);
    expect(deleted.pancake_webhook_events).toBeGreaterThanOrEqual(OLD);
    expect(deleted.analytics_events).toBeGreaterThanOrEqual(OLD);

    const alive = async () => ({
      n: await ids(prisma.notificationLog.findMany({ where: { templateCode: tag }, select: { id: true } })),
      p: await ids(prisma.pancakeWebhookEvent.findMany({ where: { eventType: tag }, select: { id: true } })),
      g: await ids(prisma.gomdonWebhookEvent.findMany({ where: { dedupeKey: { startsWith: tag } }, select: { id: true } })),
      o: await ids(prisma.oaInboundMessage.findMany({ where: { zaloUserId: tag }, select: { id: true } })),
      t: await ids(prisma.refreshToken.findMany({ where: { tokenHash: { startsWith: tag } }, select: { id: true } })),
      a: await ids(prisma.analyticsEvent.findMany({ where: { eventId: { startsWith: tag } }, select: { id: true } })),
    });
    const after = await alive();
    expect(after.n).toEqual(new Set([nNew.id]));
    expect(after.p).toEqual(new Set([pNew.id]));
    expect(after.g).toEqual(new Set([gNew.id]));
    expect(after.o).toEqual(new Set([oNew.id]));
    expect(after.t).toEqual(new Set([tRevokedNew.id, tExpiredNew.id, tLive.id]));
    expect(after.a).toEqual(new Set([aNoSnap.id, aFresh.id]));
    for (const row of [...nOld, ...pOld, ...aSnap, gOld, oOld, tRevokedOld, tExpiredOld]) {
      expect([after.n, after.p, after.g, after.o, after.t, after.a].some((s) => s.has(row.id))).toBe(false);
    }

    // Chạy lại: không còn gì quá hạn thuộc bộ dữ liệu này → bảng còn nguyên.
    const second = await run();
    expect(second).toMatchObject({ truncated: false });
    expect(await alive()).toEqual(after);
  });

  it('TTL đọc từ SystemConfig, đặt thấp hơn sàn thì kẹp về sàn', async () => {
    await setConfig(prisma, 'retention.notification_logs_days', 0);
    const t = randCode(8);
    const keep = await prisma.notificationLog.create({
      data: { userId, templateCode: t, channel: 'INAPP', payload: {}, status: 'SENT', sentAt: ago(10) },
    });
    const drop = await prisma.notificationLog.create({
      data: { userId, templateCode: t, channel: 'INAPP', payload: {}, status: 'SENT', sentAt: ago(40) },
    });
    // Cache SystemConfig 60s: dùng service mới để đọc giá trị vừa ghi.
    const fresh = new DataRetentionService(prisma, new SystemConfigService(prisma));
    await fresh.runAll({ batchSize: 2, pauseMs: 0 });
    const left = await prisma.notificationLog.findMany({ where: { templateCode: t }, select: { id: true } });
    expect(left.map((r) => r.id)).toEqual([keep.id]);
    expect(left.some((r) => r.id === drop.id)).toBe(false);
    await prisma.systemConfig.deleteMany({ where: { key: 'retention.notification_logs_days' } });
  });

  it('hai instance chạy đồng thời: chỉ một bên làm việc, bên kia LOCKED', async () => {
    const a = new DataRetentionService(prisma, new SystemConfigService(prisma));
    const b = new DataRetentionService(prisma, new SystemConfigService(prisma));
    const t = randCode(8);
    await prisma.notificationLog.createMany({
      data: Array.from({ length: 40 }, () => ({ userId, templateCode: t, channel: 'INAPP', payload: {}, status: 'SENT', sentAt: ago(300) })),
    });
    const [ra, rb] = await Promise.all([
      a.runAll({ batchSize: 5, pauseMs: 50 }),
      b.runAll({ batchSize: 5, pauseMs: 50 }),
    ]);
    const skipped = [ra, rb].filter((r) => 'skipped' in r);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toEqual({ skipped: 'LOCKED' });
    expect(await prisma.notificationLog.count({ where: { templateCode: t } })).toBe(0);
  });
});
