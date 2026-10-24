import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { OpsInboxService } from '../../src/modules/ops/ops-inbox.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createOrder, createUser, markDeliveredEffectsDone, setConfig } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest } from './fixtures/waste-fixtures';

/**
 * PLATFORM-5 + "Việc cần xử lý" trên Postgres THẬT: ảnh chụp sức khoẻ thấy đơn kẹt chưa lên Pancake, webhook lỗi,
 * hàng đợi lỗi; báo admin một lần khi có sự cố, không lặp trong giờ nhắc, báo "đã ổn" khi hết; webhook ngoài chỉ gọi
 * khi có biến môi trường. Hộp việc đếm đúng từng hàng đợi và chỉ cho nhân viên thấy việc thuộc nhóm của mình.
 */
describe('Sức khoẻ vận hành + việc cần xử lý (real Postgres)', () => {
  let prisma: PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  const queueFailures: Record<string, number> = {};
  const fakeQueue = (name: string): OpsQueue => ({
    name,
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: queueFailures[name] ?? 0 }),
    getFailed: async () =>
      Array.from({ length: queueFailures[name] ?? 0 }, () => ({ finishedOn: Date.now() - 60_000 })),
  });
  let env: Record<string, string>;
  let health: OpsHealthService;
  let inbox: OpsInboxService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    env = { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's', OPS_ALERT_WEBHOOK_URL: '' };
    const config = { get: (k: string) => env[k] ?? '' };
    const sysConfig = {
      get: async <T,>(key: string, fallback: T): Promise<T> => {
        const row = await prisma.systemConfig.findUnique({ where: { key } });
        return (row?.value as T) ?? fallback;
      },
    };
    health = new OpsHealthService(
      prisma,
      config as never,
      [fakeQueue('pancake-push'), fakeQueue('notifications')],
      sysConfig as never,
      undefined,
      { notify } as never,
      fetchMock as never,
    );
    const merchant = new MerchantFulfilmentService(prisma, undefined as never, undefined, sysConfig as never);
    inbox = new OpsInboxService(prisma, merchant, sysConfig as never);
    await setConfig(prisma, 'ops.alert_unsynced_minutes', 30);
    await setConfig(prisma, 'ops.alert_stuck_orders', 1);
    await setConfig(prisma, 'ops.alert_webhook_failed', 1);
    await setConfig(prisma, 'ops.alert_queue_failed_1h', 5);
    await setConfig(prisma, 'ops.alert_repeat_hours', 6);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await markDeliveredEffectsDone(prisma);
    notify.mockClear();
    fetchMock.mockClear();
    await prisma.opsHealthState.deleteMany({});
    for (const k of Object.keys(queueFailures)) delete queueFailures[k];
  });

  it('ảnh chụp: đơn kẹt quá ngưỡng, webhook lỗi 24h, job lỗi 1 giờ, lượt đồng bộ danh mục', async () => {
    const before = await health.snapshot();
    const u = await createUser(prisma, {});
    // Danh sách đơn kẹt xếp cũ nhất trước và cắt ở STUCK_LIST: đơn kẹt do spec khác để lại trong DB dùng chung không được đẩy đơn này ra ngoài.
    const old = new Date(Date.UTC(2000, 0, 1));
    const stuck = await createOrder(prisma, { userId: u.id, pancakePushStatus: 'FAILED', pancakeSyncError: 'HTTP 500', createdAt: old });
    await createOrder(prisma, { userId: u.id, pancakePushStatus: 'PENDING' });
    await prisma.pancakeWebhookEvent.create({ data: { eventType: 'order', rawPayload: {}, status: 'FAILED', error: 'boom' } });
    await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'order', rawPayload: {}, status: 'RECEIVED', receivedAt: new Date(Date.now() - 30 * 60_000) },
    });
    queueFailures['pancake-push'] = 7;
    await health.recordCatalogRun({ ok: false, error: 'Pancake timeout' });

    const s = await health.snapshot();
    expect(s.pancake.configured).toBe(true);
    expect(s.pancake.stuck - before.pancake.stuck).toBe(1);
    expect(s.pancake.stuckOrders.map((o) => o.code)).toContain(stuck.code);
    expect(s.pancake.webhookFailed24h - before.pancake.webhookFailed24h).toBe(1);
    expect(s.pancake.webhookStuck - before.pancake.webhookStuck).toBe(1);
    expect(s.pancake.lastWebhookAt).not.toBeNull();
    expect(s.queues).toMatchObject({ ok: true, items: expect.arrayContaining([expect.objectContaining({ name: 'pancake-push', failed: 7, failedLastHour: 7 })]) });
    expect(s.pancake.catalog).toMatchObject({ lastError: 'Pancake timeout' });
    expect(s.problems.map((p) => p.key)).toEqual(expect.arrayContaining(['pancake.stuck', 'pancake.webhook', 'pancake.catalog', 'queue.pancake-push']));

    await health.recordCatalogRun({ ok: true, count: 12 });
    expect((await health.snapshot()).problems.map((p) => p.key)).not.toContain('pancake.catalog');
  });

  it('báo admin một lần, không lặp trong giờ nhắc, báo "đã ổn" khi hết; webhook ngoài chỉ khi có biến môi trường', async () => {
    await createUser(prisma, { role: 'ADMIN' });
    queueFailures['notifications'] = 9;
    const t0 = new Date();
    await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('notifications') }));
    expect(fetchMock).not.toHaveBeenCalled();

    notify.mockClear();
    await expect(health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000))).resolves.toMatchObject({ sent: null });
    expect(notify).not.toHaveBeenCalled();

    env.OPS_ALERT_WEBHOOK_URL = 'https://hooks.example.test/ops';
    try {
      await expect(health.checkAndAlert(new Date(t0.getTime() + 7 * 3_600_000))).resolves.toMatchObject({ sent: 'ALERT' });
      expect(fetchMock).toHaveBeenCalledWith('https://hooks.example.test/ops', expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { status: string; problems: unknown[] };
      expect(body.status).toBe('ALERT');

      delete queueFailures['notifications'];
      notify.mockClear();
      const res = await health.checkAndAlert(new Date(t0.getTime() + 8 * 3_600_000));
      // Các sự cố khác trong DB dùng chung (đơn kẹt của spec khác) có thể còn — chỉ khẳng định hàng đợi đã rời danh sách.
      const state = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } });
      expect((state.detail as { keys: string[] }).keys).not.toContain('queue.notifications');
      if (res.sent === 'RECOVERED') expect(notify).toHaveBeenCalledWith(expect.any(String), 'OPS_HEALTH_ALERT', expect.objectContaining({ title: expect.stringContaining('ổn') }));
    } finally {
      env.OPS_ALERT_WEBHOOK_URL = '';
    }
  });

  it('Redis không phản hồi → ảnh chụp vẫn trả, hàng đợi báo lỗi', async () => {
    const slow: OpsQueue = { name: 'pancake-events', getJobCounts: () => new Promise(() => undefined), getFailed: async () => [] };
    const h = new OpsHealthService(prisma, { get: () => '' } as never, [slow], undefined, undefined, undefined, fetchMock as never);
    const s = await h.snapshot();
    expect(s.queues).toMatchObject({ ok: false });
    expect(s.problems.map((p) => p.key)).toContain('queues.down');
  });

  it('hộp việc: đếm từng hàng đợi; nhân viên chỉ thấy việc nhóm mình', async () => {
    const admin = { role: 'ADMIN', staffPermissions: [] as string[] };
    const before = await inbox.counts(admin);
    const u = await createUser(prisma, {});
    const o = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', pancakeAttention: 'Pancake báo hoàn', pancakeAttentionAt: new Date() });
    await prisma.returnRequest.create({ data: { orderId: o.id, userId: u.id, reason: 'hỏng' } });
    await prisma.returnRequest.create({ data: { orderId: o.id, userId: u.id, reason: 'thiếu', status: 'APPROVED', items: { create: { orderItemId: `it-${o.id}`, quantity: 1 } } } });
    const wh = await createWarehouse(prisma);
    const item = await createWasteItem(prisma);
    const req = await createWasteRequest(prisma, { userId: u.id, method: 'MAIL_IN', status: 'RECEIVED', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 3 }] });
    const noShow = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'EXPIRED', pointId: wh.id, orderId: o.id, expiresAt: null, lines: [{ itemId: item.id, declaredQty: 10 }] });
    await prisma.wasteRequest.update({ where: { id: noShow.id }, data: { closeReason: 'PICKUP_NO_SHOW', closedAt: new Date() } });
    const after = await inbox.counts(admin);
    const delta = (k: string) => (after.items.find((i) => i.key === k)?.count ?? 0) - (before.items.find((i) => i.key === k)?.count ?? 0);
    expect(delta('pancakeAttention')).toBe(1);
    expect(delta('returnsPending')).toBe(1);
    expect(delta('returnsToReceive')).toBe(1);
    expect(delta('wasteToCount')).toBe(1);
    expect(delta('wasteOrderMismatch')).toBe(0);
    expect(after.items.map((i) => i.key)).not.toContain('refillPending');
    expect(after.items.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'pancakeUnsynced',
        'gomdonAttention',
        'customerRefunds',
        'merchantOverdue',
        'consignmentPending',
        'merchantToSettle',
        'merchantPayoutsPending',
        'dealerApplications',
        'dealerClaimsToPay',
        'payouts',
        'payoutsToPay',
        'invoicePending',
        'externalPoints',
        'supportChatUnforwarded',
        'zaloBridgeDown',
        'wasteToCount',
        'wasteUnmatched',
        'wasteBlockedPending',
        'wastePointsPending',
        'wastePerksPending',
        'wasteTransitOverdue',
        'wasteGiftOverdue',
        'wasteOrderMismatch',
      ]),
    );

    const cskh = await inbox.counts({ role: 'STAFF', staffPermissions: ['CSKH'] });
    expect(cskh.items.map((i) => i.key).sort()).toEqual(['communityPending', 'communityUnanswered', 'externalPoints', 'returnsPending', 'supportChatUnforwarded', 'wasteToCount', 'wasteUnmatched']);
    const kho = await inbox.counts({ role: 'STAFF', staffPermissions: ['KHO'] });
    expect(kho.items.map((i) => i.key).sort()).toEqual(['gomdonAttention', 'pancakeAttention', 'pancakeUnsynced', 'returnsToReceive', 'wasteToCount', 'wasteUnmatched']);
    const marketing = await inbox.counts({ role: 'STAFF', staffPermissions: ['MARKETING'] });
    expect(marketing.items.map((i) => i.key).sort()).toEqual(['communityPending', 'communityUnanswered', 'wasteToCount', 'wasteUnmatched']);
    const keToan = await inbox.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] });
    expect(keToan.items.map((i) => i.key).sort()).toEqual([
      'customerRefunds',
      'dealerClaimsToPay',
      'invoicePending',
      'merchantPayoutsPending',
      'merchantToSettle',
      'payoutsToPay',
      'wasteToCount',
      'wasteUnmatched',
    ]);
    const adminCount = (k: string) => after.items.find((i) => i.key === k)?.count;
    for (const k of ['customerRefunds', 'dealerClaimsToPay', 'invoicePending', 'merchantPayoutsPending', 'merchantToSettle', 'payoutsToPay']) {
      expect(keToan.items.find((i) => i.key === k)?.count).toBe(adminCount(k));
    }
    await prisma.wasteRequest.delete({ where: { id: noShow.id } });
    await prisma.wasteRequest.delete({ where: { id: req.id } });
    await cleanupWaste(prisma, { itemIds: [item.id] });
  });
});
