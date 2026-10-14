import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeWebhookController } from '../../src/modules/integrations/pancake/pancake-webhook.controller';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeEventsReconcileService } from '../../src/modules/integrations/pancake/pancake-events-reconcile.service';
import { pancakeDedupeKey } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, sleep, summarize, warmPool } from './helpers';

const mockQueue = () => ({
  getJob: jest.fn().mockResolvedValue(null),
  add: jest.fn().mockResolvedValue({}),
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/**
 * C-045: webhook Pancake dedupe theo khoá sự kiện (unique), worker claim nguyên tử (không xử lý 2 lần),
 * cron cứu sự kiện RECEIVED/FAILED/PROCESSING kẹt có giới hạn lượt + khoá chống chạy chồng. Postgres thật.
 */
describe('Pancake webhook dedupe + cứu sự kiện kẹt (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
  const queue = mockQueue();

  const controller = () =>
    new PancakeWebhookController(prisma, { get: () => '' } as never, queue as unknown as Queue);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    processor = new PancakeProcessor(
      prisma,
      { notify: jest.fn() } as unknown as NotificationsService,
      { setStatus: jest.fn() } as unknown as OrderStatusService,
    );
  });

  beforeEach(() => {
    queue.add.mockClear();
    queue.getJob.mockClear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('(a) cùng payload gửi 5 lần đồng thời → 1 dòng, mọi lần enqueue cùng jobId', async () => {
    const pid = `P${randCode(10)}`;
    const body = { type: 'orders', id: pid, status: 3, updated_at: '2026-10-10T10:00:00.123456' };

    const insertSpy = jest.spyOn(prisma.pancakeWebhookEvent, 'create');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => controller().handle({ ...body })));
    const inserts = insertSpy.mock.calls.length;
    insertSpy.mockRestore();
    const s = summarize(results);
    const rows = await prisma.pancakeWebhookEvent.findMany({
      where: { dedupeKey: pancakeDedupeKey('orders', body) },
    });

    console.log('[a] fulfilled=%d rejected=%d inserts=%d rows=%d errors=%j', s.fulfilled.length, s.rejected.length, inserts, rows.length, s.errors);
    expect(s.rejected).toHaveLength(0);
    expect(inserts).toBe(5);
    expect(rows).toHaveLength(1);
    const jobIds = new Set(queue.add.mock.calls.map((c) => (c[2] as { jobId?: string })?.jobId));
    expect(jobIds).toEqual(new Set([rows[0]!.id]));
  });

  it('(b) khoá không phụ thuộc thứ tự field; payload khác (đổi trạng thái) là sự kiện riêng', async () => {
    const pid = `P${randCode(10)}`;
    await controller().handle({ type: 'orders', id: pid, status: 1, partner: { a: 1, b: 2 } });
    await controller().handle({ partner: { b: 2, a: 1 }, status: 1, id: pid, type: 'orders' });
    await controller().handle({ type: 'orders', id: pid, status: 2, partner: { a: 1, b: 2 } });
    const rows = await prisma.pancakeWebhookEvent.findMany({
      where: { rawPayload: { path: ['id'], equals: pid } },
    });
    expect(rows).toHaveLength(2);
  });

  it('(c) gửi lại sự kiện đã PROCESSED → không enqueue lại', async () => {
    const body = { type: 'orders', id: `P${randCode(10)}`, status: 3 };
    await controller().handle(body);
    const ev = await prisma.pancakeWebhookEvent.findFirstOrThrow({ where: { dedupeKey: pancakeDedupeKey('orders', body) } });
    await prisma.pancakeWebhookEvent.update({ where: { id: ev.id }, data: { status: 'PROCESSED' } });
    queue.add.mockClear();
    const r = await controller().handle({ ...body });
    expect(r).toEqual({ received: true, duplicate: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('(d) 5 worker cùng xử lý 1 sự kiện → handler chạy đúng 1 lần, attempts=1, PROCESSED', async () => {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: { id: `P${randCode(10)}` }, status: 'RECEIVED' },
    });
    const handleSpy = jest
      .spyOn(processor as unknown as { handle: () => Promise<void> }, 'handle')
      .mockImplementation(async () => {
        await sleep(300);
      });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>)),
    );
    const calls = handleSpy.mock.calls.length;
    handleSpy.mockRestore();
    const after = await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } });

    console.log('[d] handleCalls=%d status=%s attempts=%d errors=%j', calls, after.status, after.attempts, summarize(results).errors);
    expect(summarize(results).rejected).toHaveLength(0);
    expect(calls).toBe(1);
    expect(after.status).toBe('PROCESSED');
    expect(after.attempts).toBe(1);
  });

  it('(e) xử lý lỗi → FAILED, lần sau claim lại được; sự kiện PROCESSING mới claim thì không chạy chồng', async () => {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: { id: `P${randCode(10)}` }, status: 'RECEIVED' },
    });
    const spy = jest
      .spyOn(processor as unknown as { handle: () => Promise<void> }, 'handle')
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue(undefined);
    await expect(processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>)).rejects.toThrow('db blip');
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('FAILED');
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    const after = await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after.status).toBe('PROCESSED');
    expect(after.attempts).toBe(2);

    const busy = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: { id: 'x' }, status: 'PROCESSING', claimedAt: new Date(), attempts: 1 },
    });
    spy.mockClear();
    await processor.process({ data: { eventId: busy.id } } as Job<{ eventId: string }>);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('(f) cron cứu: chỉ enqueue sự kiện kẹt đủ điều kiện; 2 instance chạy đồng thời chỉ 1 instance quét', async () => {
    // Dọn sự kiện kẹt của các ca trên để lô quét chỉ gồm dữ liệu ca này.
    await prisma.pancakeWebhookEvent.updateMany({
      where: { status: { in: ['RECEIVED', 'FAILED', 'PROCESSING', 'UNMATCHED'] } },
      data: { status: 'PROCESSED' },
    });
    const mk = (data: { status: string; receivedAt: Date; attempts?: number; claimedAt?: Date; eventType?: string }) =>
      prisma.pancakeWebhookEvent.create({
        data: { eventType: data.eventType ?? 'orders', rawPayload: { id: randCode(6) }, ...data },
      });
    const failed = await mk({ status: 'FAILED', receivedAt: minutesAgo(30), attempts: 5 });
    const received = await mk({ status: 'RECEIVED', receivedAt: minutesAgo(10) });
    const stuck = await mk({ status: 'PROCESSING', receivedAt: minutesAgo(60), claimedAt: minutesAgo(30), attempts: 1 });
    const fresh = await mk({ status: 'RECEIVED', receivedAt: new Date() });
    const exhausted = await mk({ status: 'FAILED', receivedAt: minutesAgo(30), attempts: PancakeEventsReconcileService.MAX_ATTEMPTS });
    const tooOld = await mk({ status: 'FAILED', receivedAt: minutesAgo(60 * 48), attempts: 1 });
    const busy = await mk({ status: 'PROCESSING', receivedAt: minutesAgo(30), claimedAt: minutesAgo(1), attempts: 1 });
    const stock = await mk({ status: 'FAILED', receivedAt: minutesAgo(30), attempts: 1, eventType: 'variation.stock_changed' });
    // Chưa khớp đơn (webhook tới trước khi lưu pancakeOrderId): đối chiếu lại vài lần trong cửa sổ ngắn rồi thôi.
    const unmatched = await mk({ status: 'UNMATCHED', receivedAt: minutesAgo(12), attempts: 1 });
    const unmatchedLate = await mk({
      status: 'UNMATCHED',
      receivedAt: minutesAgo(PancakeEventsReconcileService.UNMATCHED_WINDOW_MINUTES + 5),
      attempts: 1,
    });
    const unmatchedDone = await mk({
      status: 'UNMATCHED',
      receivedAt: minutesAgo(20),
      attempts: PancakeEventsReconcileService.UNMATCHED_MAX_ATTEMPTS,
    });

    const q1 = mockQueue();
    const q2 = mockQueue();
    // Giữ khoá đủ lâu để instance kia chắc chắn chạm vào khoá khi instance này đang quét.
    q1.add.mockImplementation(async () => sleep(150));
    q2.add.mockImplementation(async () => sleep(150));
    const s1 = new PancakeEventsReconcileService(prisma, q1 as unknown as Queue);
    const s2 = new PancakeEventsReconcileService(prisma, q2 as unknown as Queue);
    const [r1, r2] = await Promise.all([s1.redriveEvents(), s2.redriveEvents()]);

    const enqueued = [...q1.add.mock.calls, ...q2.add.mock.calls].map((c) => (c[1] as { eventId: string }).eventId);
    console.log('[f] r1=%j r2=%j enqueued=%d', r1, r2, enqueued.length);
    expect([r1, r2].filter((r) => 'skipped' in r)).toHaveLength(1);
    expect(new Set(enqueued)).toEqual(new Set([failed.id, received.id, stuck.id, unmatched.id]));
    expect(enqueued).toHaveLength(4);
    for (const e of [fresh, exhausted, tooOld, busy, stock, unmatchedLate, unmatchedDone]) expect(enqueued).not.toContain(e.id);
  });
});
