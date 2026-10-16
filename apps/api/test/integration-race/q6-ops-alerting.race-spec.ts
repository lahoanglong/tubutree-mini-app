import { Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { gomdonBacklogWhere, OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { OpsWebhookEventsService } from '../../src/modules/ops/ops-webhook-events.service';
import { PancakeEventsReconcileService } from '../../src/modules/integrations/pancake/pancake-events-reconcile.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { GomdonReconcileService } from '../../src/modules/integrations/gomdon/gomdon-reconcile.service';
import { GomdonWebhookService } from '../../src/modules/integrations/gomdon/gomdon-webhook.service';
import { createOrder, createUser, markDeliveredEffectsDone, setConfig } from './helpers';

/**
 * q6-platform-ops trên Postgres THẬT: báo động webhook lỗi nêu mã đơn và không tự "đã ổn" sau 24 giờ khi sự kiện còn
 * lỗi (R2-PLATFORM-1); chạy lại / đánh dấu đã xử lý; webhook báo động gửi lỗi thì lượt sau gửi lại, payload Slack có
 * `text` (R2-PLATFORM-2); đơn cần xử lý Pancake là một sự cố (R2-ADMINOPS-5); đơn thu gom chờ vận đơn Gomdon quá ngưỡng
 * là một sự cố (R2-GOMDON-4).
 */
describe('q6 báo động vận hành (real Postgres)', () => {
  let prisma: PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const fetchMock = jest.fn();
  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const fakeJobQueue = { name: 'pancake-events', getJob: async () => null, add: queueAdd };
  const queueFailures: Record<string, number> = {};
  const fakeQueue = (name: string): OpsQueue => ({
    name,
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: queueFailures[name] ?? 0 }),
    getFailed: async () => Array.from({ length: queueFailures[name] ?? 0 }, () => ({ finishedOn: Date.now() - 60_000 })),
  });
  const env: Record<string, string> = { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's', OPS_ALERT_WEBHOOK_URL: '' };
  let health: OpsHealthService;
  let events: OpsWebhookEventsService;
  let adminId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const sysConfig = {
      get: async <T,>(key: string, fallback: T): Promise<T> => {
        const row = await prisma.systemConfig.findUnique({ where: { key } });
        return (row?.value as T) ?? fallback;
      },
    };
    const gomdon = { getConfig: async () => ({ baseUrl: 'http://gomdon.invalid', phone: '0900000000', password: 'x' }), getHealth: () => null };
    health = new OpsHealthService(
      prisma,
      { get: (k: string) => env[k] ?? '' } as never,
      [fakeQueue('pancake-push'), fakeQueue('notifications')],
      sysConfig as never,
      gomdon as never,
      { notify } as never,
      fetchMock as never,
    );
    events = new OpsWebhookEventsService(prisma, fakeJobQueue as never, { ...fakeJobQueue, name: 'gomdon-events' } as never);
    await setConfig(prisma, 'ops.alert_webhook_failed', 1);
    await setConfig(prisma, 'ops.alert_repeat_hours', 6);
    await setConfig(prisma, 'ops.alert_gomdon_backlog_minutes', 15);
    adminId = (await createUser(prisma, { role: 'ADMIN' })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await markDeliveredEffectsDone(prisma);
    notify.mockClear();
    fetchMock.mockReset();
    queueAdd.mockClear();
    for (const k of Object.keys(queueFailures)) delete queueFailures[k];
    env.OPS_ALERT_WEBHOOK_URL = '';
    await prisma.opsHealthState.deleteMany({});
    // Sự kiện còn mở của spec khác dùng chung DB: gác lại để báo động ở đây chỉ phản ánh dữ liệu của spec này.
    await prisma.pancakeWebhookEvent.updateMany({ where: { dismissedAt: null }, data: { dismissedAt: new Date() } });
    await prisma.gomdonWebhookEvent.updateMany({ where: { dismissedAt: null }, data: { dismissedAt: new Date() } });
  });

  it('webhook Pancake lỗi quá 24 giờ: vẫn báo, kèm mã đơn; không "đã ổn" tới khi chạy lại hoặc đánh dấu đã xử lý', async () => {
    const code = `TUBUQ6${Date.now()}`;
    const t0 = new Date();
    const ev = await prisma.pancakeWebhookEvent.create({
      data: {
        eventType: 'order.status_updated',
        rawPayload: { id: 987654, status: 3, extension: { external_order_id: code } },
        status: 'FAILED',
        attempts: 15,
        error: 'boom',
        receivedAt: new Date(t0.getTime() - 25 * 3_600_000),
      },
    });

    const snap = await health.snapshot(t0);
    expect(snap.pancake.failedEvents).toEqual(expect.arrayContaining([expect.objectContaining({ id: ev.id, orderRef: code, attempts: 15 })]));
    const hook = snap.problems.find((p) => p.key === 'pancake.webhook');
    expect(hook?.message).toContain(code);

    await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });
    // Người nhận là tối đa MAX_ADMINS admin đầu bảng: DB dùng chung với spec khác có thể đã quá số đó, nên không chờ đúng adminId.
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining(code) }));

    // Thêm 24 giờ nữa trôi qua: sự kiện vẫn lỗi → không được báo "đã ổn".
    notify.mockClear();
    const later = new Date(t0.getTime() + 24 * 3_600_000);
    const res = await health.checkAndAlert(later);
    expect(res.sent).not.toBe('RECOVERED');
    expect(res.problems.map((p) => p.key)).toContain('pancake.webhook');

    // Chạy lại: đặt lại số lần thử, đưa vào hàng đợi với jobId = id sự kiện.
    await events.retry('pancake', ev.id, adminId);
    expect(queueAdd).toHaveBeenCalledWith('process', { eventId: ev.id }, expect.objectContaining({ jobId: ev.id }));
    expect(await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'RECEIVED', attempts: 0, error: null });

    // Đánh dấu đã xử lý → rời báo động.
    await events.dismiss('pancake', ev.id, adminId);
    await expect(events.dismiss('pancake', ev.id, adminId)).rejects.toThrow('đã được đánh dấu');
    const after = await health.snapshot(later);
    expect(after.pancake.failedEvents.map((e) => e.id)).not.toContain(ev.id);
    expect(after.problems.map((p) => p.key)).not.toContain('pancake.webhook');
  });

  it('chạy lại sự kiện đã xử lý xong → từ chối, không đưa vào hàng đợi', async () => {
    const ev = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'order', rawPayload: {}, status: 'PROCESSED' } });
    await expect(events.retry('pancake', ev.id, adminId)).rejects.toThrow('đã được xử lý xong');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('Đã xử lý: cron cứu hộ Pancake/Gomdon không đưa lại vào hàng đợi, job đang retry dở cũng không chạy; Chạy lại thì cứu tiếp', async () => {
    const ago = (m: number) => new Date(Date.now() - m * 60_000);
    const pev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'order.status_updated', rawPayload: { id: 4242, status: 6 }, status: 'FAILED', attempts: 2, error: 'boom', receivedAt: ago(30) },
    });
    const gev = await prisma.gomdonWebhookEvent.create({
      data: { dedupeKey: `q6-dismiss-${Date.now()}`, orderCode: 'TUBUQ6DISMISS', gomdonStatus: 6, rawPayload: { status: 6 }, status: 'FAILED', attempts: 2, receivedAt: ago(30) },
    });
    await events.dismiss('pancake', pev.id, adminId);
    await events.dismiss('gomdon', gev.id, adminId);

    const pq = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
    const gq = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
    const pancakeCron = new PancakeEventsReconcileService(prisma, pq as never);
    const gomdonCron = new GomdonReconcileService(prisma, {} as never, gq as never, {} as never);
    const enqueuedIds = (q: typeof pq) => q.add.mock.calls.map((c) => (c[1] as { eventId: string }).eventId);

    await pancakeCron.redriveEvents();
    await gomdonCron.redriveEvents();
    expect(enqueuedIds(pq)).not.toContain(pev.id);
    expect(enqueuedIds(gq)).not.toContain(gev.id);

    const processor = new PancakeProcessor(prisma, { notify: jest.fn() } as never, { setStatus: jest.fn() } as never);
    const handle = jest.spyOn(processor as unknown as { handle: () => Promise<string> }, 'handle').mockResolvedValue('OK');
    await processor.process({ data: { eventId: pev.id } } as never);
    expect(handle).not.toHaveBeenCalled();
    expect(await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: pev.id } })).toMatchObject({ status: 'FAILED', attempts: 2 });

    const gomdonWebhook = new GomdonWebhookService(prisma, {} as never, {} as never, gq as never, {} as never);
    const apply = jest.spyOn(gomdonWebhook as unknown as { apply: () => Promise<unknown> }, 'apply').mockResolvedValue({ status: 'PROCESSED' });
    await gomdonWebhook.processEvent(gev.id);
    expect(apply).not.toHaveBeenCalled();
    expect(await prisma.gomdonWebhookEvent.findUniqueOrThrow({ where: { id: gev.id } })).toMatchObject({ status: 'FAILED', attempts: 2 });

    await events.retry('pancake', pev.id, adminId);
    await events.retry('gomdon', gev.id, adminId);
    pq.add.mockClear();
    gq.add.mockClear();
    await pancakeCron.redriveEvents();
    await gomdonCron.redriveEvents();
    expect(enqueuedIds(pq)).toContain(pev.id);
    expect(enqueuedIds(gq)).toContain(gev.id);
    await processor.process({ data: { eventId: pev.id } } as never);
    expect(handle).toHaveBeenCalledTimes(1);
    await prisma.pancakeWebhookEvent.update({ where: { id: pev.id }, data: { status: 'PROCESSED' } });
    await prisma.gomdonWebhookEvent.update({ where: { id: gev.id }, data: { status: 'PROCESSED' } });
  });

  it('Chạy lại sự kiện tồn kho (variation.stock_changed) → từ chối, chỉ đánh dấu Đã xử lý được', async () => {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'variation.stock_changed', rawPayload: { id: 'v1', remain_quantity: 5 }, status: 'FAILED', attempts: 3, error: 'boom' },
    });
    await expect(events.retry('pancake', ev.id, adminId)).rejects.toThrow('Đồng bộ danh mục');
    expect(queueAdd).not.toHaveBeenCalled();
    expect(await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'FAILED', attempts: 3, error: 'boom' });
    await events.dismiss('pancake', ev.id, adminId);
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).dismissedAt).not.toBeNull();
  });

  it('webhook Gomdon lỗi: nêu mã đơn, chạy lại được', async () => {
    const code = `TUBUG6${Date.now()}`;
    const ev = await prisma.gomdonWebhookEvent.create({
      data: { dedupeKey: `q6-${code}`, orderCode: code, gomdonStatus: 3, rawPayload: {}, status: 'FAILED', attempts: 15, receivedAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    const snap = await health.snapshot();
    expect(snap.problems.find((p) => p.key === 'gomdon.webhook')?.message).toContain(code);
    await events.retry('gomdon', ev.id, adminId);
    expect(await prisma.gomdonWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'RECEIVED', attempts: 0 });
  });

  it('webhook báo động trả lỗi → lượt sau gửi lại (không chờ 6 giờ), in-app chỉ một lần; Slack nhận {text}', async () => {
    env.OPS_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/T0/B0/XXX';
    queueFailures['notifications'] = 9;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, status: 200 });
    const t0 = new Date();

    await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const state = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } });
    expect(state.detail).toMatchObject({ webhookPending: true });

    notify.mockClear();
    await expect(health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000))).resolves.toMatchObject({ sent: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['text']);
    expect(body.text).toContain('notifications');
    expect((await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } })).detail).not.toHaveProperty('webhookPending');

    await expect(health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000 + 1000))).resolves.toMatchObject({ sent: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('OPS-8: hook trả 4xx là lỗi vĩnh viễn, không gửi lại mỗi 5 phút', () => {
    const HOOK_URL = 'https://hooks.slack.com/services/T0/B0/SECRETTOKEN';
    const webhookWarnings = (warn: jest.SpyInstance) => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Webhook báo động'));

    it.each([400, 401, 403, 404, 410])('HTTP %i: cảnh báo đúng một lần (không URL/bí mật), không đặt webhookPending, lượt sau không gửi lại', async (status) => {
      env.OPS_ALERT_WEBHOOK_URL = HOOK_URL;
      queueFailures['notifications'] = 9;
      fetchMock.mockResolvedValue({ ok: false, status });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const t0 = new Date();
        await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });
        expect((await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } })).detail).not.toHaveProperty('webhookPending');
        // Dừng ở 10 phút: đơn dở dang của spec khác chạm ngưỡng gomdon.backlog (15 phút) ở lượt 15 sẽ là sự cố mới thật.
        for (const m of [5, 10]) await expect(health.checkAndAlert(new Date(t0.getTime() + m * 60_000))).resolves.toMatchObject({ sent: null });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const lines = webhookWarnings(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`HTTP ${status}`);
        expect(lines[0]).not.toContain('SECRETTOKEN');
        expect(lines[0]).not.toContain('hooks.slack.com');
      } finally {
        warn.mockRestore();
      }
    });

    it.each([408, 429, 500, 503])('HTTP %i (tạm thời): vẫn nhớ webhookPending và gửi lại ở lượt sau', async (status) => {
      env.OPS_ALERT_WEBHOOK_URL = HOOK_URL;
      queueFailures['notifications'] = 9;
      fetchMock.mockResolvedValue({ ok: false, status });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const t0 = new Date();
        await health.checkAndAlert(t0);
        expect((await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } })).detail).toMatchObject({ webhookPending: true });
        await health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(webhookWarnings(warn).every((m) => m.includes('gửi lại ở lượt kiểm sau'))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it('hook bị thu hồi rồi có sự cố MỚI: vẫn thử một lần cho quyết định mới (URL có thể đã được sửa), không tích lại', async () => {
      env.OPS_ALERT_WEBHOOK_URL = HOOK_URL;
      queueFailures['notifications'] = 9;
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const t0 = new Date();
        await health.checkAndAlert(t0);
        queueFailures['pancake-push'] = 9;
        await expect(health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000))).resolves.toMatchObject({ sent: 'ALERT' });
        await health.checkAndAlert(new Date(t0.getTime() + 10 * 60_000));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(webhookWarnings(warn)).toHaveLength(2);
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('đơn cần xử lý Pancake là một sự cố, kèm mã đơn', async () => {
    const u = await createUser(prisma, {});
    const o = await createOrder(prisma, { userId: u.id, pancakeAttention: 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake', pancakeAttentionAt: new Date(0) });
    const snap = await health.snapshot();
    expect(snap.pancake.attentionOrders.map((x) => x.code)).toContain(o.code);
    expect(snap.problems.find((p) => p.key === 'pancake.attention')?.message).toContain(o.code);
    await prisma.order.update({ where: { id: o.id }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
  });

  it('đơn thu gom COD quá 15 phút chưa có vận đơn Gomdon → gomdon.backlog; đơn trả trước chưa nhận tiền thì không', async () => {
    const u = await createUser(prisma, {});
    // Danh sách tồn đọng chỉ lấy STUCK_LIST đơn cũ nhất: đơn của test phải cũ hơn mọi đơn tồn đọng spec khác để lại trong DB dùng
    // chung, kể cả đơn phải bị loại (không thì "không có trong danh sách" đúng chỉ vì danh sách đã đầy).
    const cod = await createOrder(prisma, { userId: u.id, hasRecyclingPickup: true, createdAt: new Date(0) });
    const unpaid = await createOrder(prisma, { userId: u.id, hasRecyclingPickup: true, createdAt: new Date(1), paymentMethod: 'ZALOPAY', status: 'PENDING_PAYMENT' });
    const fresh = await createOrder(prisma, { userId: u.id, hasRecyclingPickup: true });
    const snap = await health.snapshot();
    const codes = snap.gomdon.backlogOrders.map((x) => x.code);
    expect(codes).toContain(cod.code);
    expect(codes).not.toContain(unpaid.code);
    // Đơn vừa đặt luôn mới nhất nên danh sách đầy không nói được gì: hỏi thẳng bộ lọc.
    const inBacklog = (id: string) => prisma.order.count({ where: { AND: [gomdonBacklogWhere(new Date(), snap.thresholds.gomdonBacklogMinutes), { id }] } });
    expect(await inBacklog(cod.id)).toBe(1);
    expect(await inBacklog(fresh.id)).toBe(0);
    expect(codes).not.toContain(fresh.code);
    expect(snap.problems.find((p) => p.key === 'gomdon.backlog')?.message).toContain('15 phút');
    await prisma.order.updateMany({ where: { id: { in: [cod.id, unpaid.id, fresh.id] } }, data: { status: 'CANCELLED' } });
  });
});
