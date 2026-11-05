import { Queue, Worker, type Job } from 'bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakePushProcessor } from '../../src/modules/integrations/pancake/pancake-push.processor';
import { PancakePushReconcileService } from '../../src/modules/integrations/pancake/pancake-push-reconcile.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { PancakeApiError } from '../../src/modules/integrations/pancake/pancake-outbound';
import { PANCAKE_JOB_PUSH } from '../../src/modules/integrations/pancake/pancake-queue';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PANCAKE_FORBIDDEN_ERROR_PREFIX } from '@tubutree/shared-types';
import { createOrder, createUser, randCode, sleep } from './helpers';

/**
 * Job push lỗi trên Postgres THẬT + BullMQ/Redis THẬT (gói hi): đơn lỗi vĩnh viễn rồi bị huỷ thì job lỗi bị gỡ; "Đẩy lại" khi job
 * lỗi cũ còn thì job mới thật sự chạy (BullMQ bỏ qua add khi jobId còn ở tập failed); 401 hàng loạt không đốt lượt từng đơn mà cron
 * chỉ dò bằng một đơn. Stub: PancakeClient (HTTP). Cần Redis rác, ví dụ:
 *   docker run --rm -d --tmpfs /data -p 46550:6379 --name hi-redis redis:7-alpine
 *   TEST_REDIS_URL=redis://127.0.0.1:46550 npx jest -c test/integration-race/jest.config.js --runInBand pancake-failed-jobs
 */
const url = process.env.TEST_REDIS_URL;
(url ? describe : describe.skip)('Pancake job lỗi (Postgres + Redis thật)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PancakeOrderService;
  let reconcile: PancakePushReconcileService;
  let queue: Queue;
  let worker: Worker;
  const mine = new Set<string>();

  const client = {
    isConfigured: jest.fn().mockReturnValue(true),
    createOrder: jest.fn(),
    searchOrders: jest.fn().mockResolvedValue([]),
    resolveOrderTags: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined), resolveKinds: jest.fn().mockResolvedValue(0) };

  const connection = () => {
    const u = new URL(url as string);
    const db = Number(u.pathname.replace(/^\//, ''));
    return { host: u.hostname, port: Number(u.port) || 6379, ...(Number.isInteger(db) && db > 0 ? { db } : {}), maxRetriesPerRequest: null as null };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    // Nhật ký MỌI giá trị pancakeErrorKind từng được ghi (không lấy mẫu): trigger AFTER UPDATE ghi lại mỗi lần cột đổi giá trị.
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS it_hi_kind_log');
    await prisma.$executeRawUnsafe('CREATE TABLE it_hi_kind_log (id bigserial PRIMARY KEY, order_id text NOT NULL, kind text)');
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION it_hi_kind_log_fn() RETURNS trigger AS $$
      BEGIN INSERT INTO it_hi_kind_log (order_id, kind) VALUES (NEW.id, NEW."pancakeErrorKind"); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS it_hi_kind_log_trg ON orders');
    await prisma.$executeRawUnsafe(`CREATE TRIGGER it_hi_kind_log_trg AFTER UPDATE ON orders FOR EACH ROW
      WHEN (OLD."pancakeErrorKind" IS DISTINCT FROM NEW."pancakeErrorKind") EXECUTE FUNCTION it_hi_kind_log_fn()`);
    const name = `it-hi-pancake-push-${Date.now()}`;
    queue = new Queue(name, {
      connection: connection(),
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 20 }, removeOnComplete: 1000, removeOnFail: { age: 30 * 24 * 3600, count: 1000 } },
    });
    service = new PancakeOrderService(prisma, client as unknown as PancakeClient, queue, undefined, alerts as unknown as GomdonAlertService);
    reconcile = new PancakePushReconcileService(prisma, client as unknown as PancakeClient, service, alerts as unknown as GomdonAlertService);
    const processor = new PancakePushProcessor(service);
    worker = new Worker(name, (job: Job) => processor.process(job), { connection: connection(), concurrency: 4 });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS it_hi_kind_log_trg ON orders').catch(() => undefined);
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS it_hi_kind_log_fn()').catch(() => undefined);
      await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS it_hi_kind_log').catch(() => undefined);
    }
    await worker?.close();
    await queue?.close();
    await moduleRef?.close();
  });

  beforeEach(() => {
    client.createOrder.mockReset();
  });

  const tubuVariationId = async () => {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `ithi-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `ithi-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `ithi-v-${tag}`, productId: product.id, sku: `ITHI-${tag}`, name: '1kg', attributes: {}, retailPrice: 100_000, stock: 20 },
    });
    return v.id;
  };

  const order = async () => {
    const buyer = await createUser(prisma);
    const o = await createOrder(prisma, {
      userId: buyer.id,
      total: 130_000,
      subtotal: 100_000,
      shippingFee: 30_000,
      items: { create: [{ variationId: await tubuVariationId(), productName: 'SP IT', variationName: '1kg', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    mine.add(o.code);
    return o;
  };

  /** Đơn của spec khác còn trong DB dùng chung: cron thật có thể kéo chúng vào hàng đợi này, trả lỗi tạm để chúng không đổi trạng thái. */
  const respond = (byMine: (code: string) => unknown) =>
    client.createOrder.mockImplementation(async (body: { custom_id: string }) => {
      if (!mine.has(body.custom_id)) throw new PancakeApiError('Pancake trả 503 (đơn ngoài spec)', true, false, 503);
      return byMine(body.custom_id);
    });
  const calls = () => client.createOrder.mock.calls.filter(([b]) => mine.has((b as { custom_id: string }).custom_id)).length;

  const until = async (cond: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await sleep(50);
    }
    throw new Error('hết giờ chờ điều kiện');
  };

  it('đơn lỗi vĩnh viễn → huỷ đơn → job lỗi bị gỡ khỏi tập failed', async () => {
    const o = await order();
    respond(() => {
      throw new PancakeApiError('Pancake trả 422 khi tạo đơn: [tags]: is invalid', false, false, 422);
    });
    await service.enqueuePush(o.id);
    await until(async () => (await queue.getJob(o.id))?.getState().then((s) => s === 'failed') ?? false);
    const failed = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(failed).toMatchObject({ pancakePushStatus: 'FAILED', pancakeErrorKind: 'REJECTED' });

    await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED', reversalEffectsAt: new Date() } });
    expect(await service.sweepSettledFailedJobs(500)).toBeGreaterThanOrEqual(1);
    expect(await queue.getJob(o.id)).toBeUndefined();
  });

  it('huỷ đơn qua đường huỷ thật (OrderStatusService → PancakeSyncHooks.afterLocalCancel), đơn chưa từng claim: job push lỗi bị gỡ', async () => {
    const cancelApp = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        { provide: PancakeSyncHooks, useValue: new PancakeSyncHooks(prisma, client as unknown as PancakeClient, queue) },
        { provide: CartService, useValue: {} },
        { provide: AffiliateService, useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), lockCommissionsForOrder: jest.fn() } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await cancelApp.init();
    try {
      const o = await order();
      respond(() => {
        throw new PancakeApiError('Pancake trả 422 khi tạo đơn: [tags]: is invalid', false, false, 422);
      });
      await service.enqueuePush(o.id);
      await until(async () => (await queue.getJob(o.id))?.getState().then((st) => st === 'failed') ?? false);
      const failed = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(failed.pancakePushClaimedAt).toBeNull();

      const staff = await createUser(prisma, { role: 'ADMIN' });
      await cancelApp.get(OrderStatusService).setStatus(o.id, 'CANCELLED', { actorType: 'ADMIN', actorId: staff.id });
      expect(await queue.getJob(o.id)).toBeUndefined();
    } finally {
      await cancelApp.close();
    }
  });

  it('huỷ đơn qua enqueueCancel cũng gỡ job push lỗi của đơn', async () => {
    const o = await order();
    respond(() => {
      throw new PancakeApiError('Pancake trả 422 khi tạo đơn', false, false, 422);
    });
    await service.enqueuePush(o.id);
    await until(async () => (await queue.getJob(o.id))?.getState().then((s) => s === 'failed') ?? false);
    await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED', reversalEffectsAt: new Date() } });
    await service.enqueueCancel(o.id);
    expect(await queue.getJob(o.id)).toBeUndefined();
  });

  it('"Đẩy lại" khi job lỗi cũ còn: job mới thật sự chạy và đơn lên Pancake', async () => {
    const o = await order();
    respond(() => {
      throw new PancakeApiError('Pancake trả 422 khi tạo đơn', false, false, 422);
    });
    await service.enqueuePush(o.id);
    await until(async () => (await queue.getJob(o.id))?.getState().then((s) => s === 'failed') ?? false);
    const before = calls();

    const pkId = `pk-${randCode(8)}`;
    respond(() => ({ success: true, data: { id: pkId } }));
    await service.retryPushByAdmin('admin-it', o.code);
    await until(async () => (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).pancakeOrderId === pkId);
    expect(calls()).toBe(before + 1);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(done).toMatchObject({ pancakePushStatus: 'SYNCED', pancakeErrorKind: null, pancakeSyncError: null });
    expect(await queue.getJob(o.id).then((j) => j?.getState())).not.toBe('failed');
  });

  it('401 hàng loạt: không đốt lượt từng đơn, không báo từng đơn; cron chỉ dò bằng MỘT đơn, dò thành công thì thả cả nhóm', async () => {
    const orders = await Promise.all([order(), order(), order(), order()]);
    respond(() => {
      throw new PancakeApiError('Pancake trả 401 khi tạo đơn: invalid api key', false, false, 401);
    });
    alerts.alert.mockClear();
    await Promise.all(orders.map((o) => service.enqueuePush(o.id)));
    const ids = orders.map((o) => o.id);
    await until(async () => (await prisma.order.count({ where: { id: { in: ids }, pancakeErrorKind: 'CONFIG', pancakePushStatus: 'FAILED', pancakePushAttempts: 0 } })) === 4);
    const rows = await prisma.order.findMany({ where: { id: { in: ids } } });
    for (const r of rows) {
      expect(r.pancakePushAttempts).toBe(0);
      expect(r.pancakeAttention).toBeNull();
    }
    expect(calls()).toBe(4);
    expect(alerts.alert.mock.calls.filter(([code]) => mine.has(code as string))).toHaveLength(0);

    // Cron: nhóm CONFIG nghỉ, chỉ một đơn được dò.
    await prisma.order.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date(Date.now() - 30 * 60_000), pancakeLastAttemptAt: new Date(Date.now() - 2 * 3_600_000) } });
    await reconcile.reconcile();
    await until(async () => calls() >= 5);
    await sleep(300);
    expect(calls()).toBe(5);

    // Khoá đã đúng lại: lần dò kế tiếp thành công và thả cả nhóm.
    respond((code) => ({ success: true, data: { id: `pk-${code}` } }));
    await prisma.order.updateMany({ where: { id: { in: ids }, pancakeOrderId: null }, data: { pancakeLastAttemptAt: new Date(Date.now() - 2 * 3_600_000) } });
    await reconcile.reconcile();
    await until(async () => (await prisma.order.count({ where: { id: { in: ids }, pancakeOrderId: { not: null } } })) >= 1);
    await sleep(300);
    const after = await prisma.order.findMany({ where: { id: { in: ids } } });
    expect(after.filter((r) => r.pancakeOrderId === null).every((r) => r.pancakeErrorKind === 'CONFIG_RECHECK')).toBe(true);
  });

  /** Hai tick của luồng PROD: tick 1 X bị 401/403 (CONFIG) rồi Y đẩy được (X → CONFIG_RECHECK); tick 2 là cron nhặt lại X. */
  const tickOne = async () => {
    const [x, y] = await Promise.all([order(), order()]);
    let key: 'bad' | 'good' = 'bad';
    respond((code) => {
      if (code === x.code && key === 'bad') throw new PancakeApiError('Pancake trả 403 khi tạo đơn: forbidden', false, false, 403);
      return { success: true, data: { id: `pk-${code}` } };
    });
    alerts.alert.mockClear();
    await service.enqueuePush(x.id);
    await until(async () => {
      const r = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
      return r.pancakePushStatus === 'FAILED' && r.pancakePushAttempts === 0;
    });
    const afterOne = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
    expect(afterOne).toMatchObject({ pancakeErrorKind: 'CONFIG', pancakePushAttempts: 0, pancakeAttention: null });

    await service.enqueuePush(y.id);
    await until(async () => (await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).pancakeErrorKind === 'CONFIG_RECHECK');
    const callsOfX = () => client.createOrder.mock.calls.filter(([body]) => (body as { custom_id: string }).custom_id === x.code).length;
    // Tick 2: pushStale lấy lô 50 đơn xếp theo lần thử cuối cũ nhất trước, chưa từng thử đứng đầu (DB dùng chung với spec khác). Để X chắc chắn
    // trong lô: đóng dấu mọi đơn chưa từng thử khác, rồi đặt lần thử cuối của X cũ hơn mọi đơn còn lại. Rồi gọi reconcile() lặp (có giới hạn)
    // tới khi X thật sự bị đẩy lại thêm một lần.
    const runTick2 = async () => {
      await prisma.order.updateMany({ where: { pancakeOrderId: null, id: { not: x.id }, pancakeLastAttemptAt: null }, data: { pancakeLastAttemptAt: new Date() } });
      await prisma.order.update({ where: { id: x.id }, data: { createdAt: new Date(Date.now() - 30 * 60_000), pancakeLastAttemptAt: new Date(Date.now() - 71 * 3_600_000) } });
      const before = callsOfX();
      for (let i = 0; i < 5 && callsOfX() === before; i++) {
        await reconcile.reconcile();
        const end = Date.now() + 2_000;
        while (callsOfX() === before && Date.now() < end) await sleep(50);
      }
      expect(callsOfX()).toBe(before + 1);
    };
    return { x, callsOfX, runTick2, setKey: (k: 'bad' | 'good') => (key = k) };
  };

  it('luồng PROD hai tick: X 403 → CONFIG; Y đẩy được → X CONFIG_RECHECK; tick 2 X lại 403 → REJECTED (đốt lượt, báo đơn), cron không dò lại ngay', async () => {
    const { x, callsOfX, runTick2 } = await tickOne();
    await runTick2();
    // pushOrder ghi REJECTED trước, markPushFailure (báo đơn) sau: chờ tới khi cả hai xong.
    await until(async () => {
      const r = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
      return r.pancakeErrorKind === 'REJECTED' && r.pancakeAttention != null;
    });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
    expect(row.pancakeOrderId).toBeNull();
    expect(row.pancakePushAttempts).toBeGreaterThanOrEqual(1);
    expect(row.pancakeAttention).not.toBeNull();
    expect(callsOfX()).toBe(2);
    await reconcile.reconcile();
    await sleep(300);
    expect(callsOfX()).toBe(2);
  });

  it('luồng PROD hai tick: tick 2 X đẩy được → loại lỗi về null, không có attention', async () => {
    const { x, runTick2, setKey } = await tickOne();
    setKey('good');
    await runTick2();
    await until(async () => (await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).pancakeOrderId != null);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
    expect(row).toMatchObject({ pancakePushStatus: 'SYNCED', pancakeErrorKind: null, pancakeAttention: null });
  });

  it('khoá hỏng thật (nhiều đơn 401, không đơn nào đẩy được): tất cả CONFIG, không đốt lượt, không báo từng đơn', async () => {
    const orders = await Promise.all([order(), order(), order()]);
    respond(() => {
      throw new PancakeApiError('Pancake trả 401 khi tạo đơn: invalid api key', false, false, 401);
    });
    alerts.alert.mockClear();
    await Promise.all(orders.map((o) => service.enqueuePush(o.id)));
    const ids = orders.map((o) => o.id);
    await until(async () => (await prisma.order.count({ where: { id: { in: ids }, pancakeErrorKind: 'CONFIG', pancakePushStatus: 'FAILED', pancakePushAttempts: 0 } })) === 3);
    const rows = await prisma.order.findMany({ where: { id: { in: ids } } });
    for (const r of rows) expect(r).toMatchObject({ pancakePushAttempts: 0, pancakeAttention: null });
    expect(alerts.alert.mock.calls.filter(([code]) => mine.has(code as string))).toHaveLength(0);
  });

  /** Mọi giá trị pancakeErrorKind đơn từng được ghi (theo thứ tự), từ nhật ký trigger. */
  const kindsWritten = async (orderId: string) =>
    (await prisma.$queryRawUnsafe<{ kind: string | null }[]>('SELECT kind FROM it_hi_kind_log WHERE order_id = $1 ORDER BY id', orderId)).map((r) => r.kind);

  const retryThen403 = async (seed: { pancakeErrorKind: string; pancakeSyncError: string | null }) => {
    const x = await order();
    await prisma.order.update({ where: { id: x.id }, data: { ...seed, pancakePushStatus: 'PENDING' } });
    let n = 0;
    respond((code) => {
      if (code !== x.code) return { success: true, data: { id: `pk-${code}` } };
      n += 1;
      if (n === 1) throw new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503);
      throw new PancakeApiError('Pancake trả 403 khi tạo đơn: forbidden', false, false, 403);
    });
    await service.enqueuePush(x.id);
    await until(async () => n >= 2 && (await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).pancakePushStatus !== 'PUSHING');
    await sleep(200);
    expect(n).toBe(2);
    return { x, row: await prisma.order.findUniqueOrThrow({ where: { id: x.id } }) };
  };

  it('job BullMQ thử lại (503 rồi 403) trên đơn CONFIG_RECHECK → REJECTED; nhật ký trigger chứng minh KHÔNG BAO GIỜ qua CONFIG', async () => {
    const { x, row } = await retryThen403({ pancakeErrorKind: 'CONFIG_RECHECK', pancakeSyncError: null });
    expect(row.pancakeErrorKind).toBe('REJECTED');
    expect(row.pancakeAttention).not.toBeNull();
    const kinds = await kindsWritten(x.id);
    expect(kinds).toContain('REJECTED');
    expect(kinds).not.toContain('CONFIG');
    expect(kinds).not.toContain('TRANSIENT');
  });

  it('đơn REJECTED vì 403 gặp 503 rồi 403 → vẫn REJECTED; nhật ký trigger: không CONFIG, không TRANSIENT, lời lỗi giữ tiền tố', async () => {
    const { x, row } = await retryThen403({ pancakeErrorKind: 'REJECTED', pancakeSyncError: `${PANCAKE_FORBIDDEN_ERROR_PREFIX}Pancake trả 403 cũ` });
    expect(row.pancakeErrorKind).toBe('REJECTED');
    expect(row.pancakeSyncError).toContain(PANCAKE_FORBIDDEN_ERROR_PREFIX);
    const kinds = await kindsWritten(x.id);
    expect(kinds).not.toContain('CONFIG');
    expect(kinds).not.toContain('TRANSIENT');
  });

  it('đơn STALE vừa được thanh toán: không đường tự động nào gọi createOrder, gắn Cần xử lý; "Đẩy lại" của admin vẫn đẩy được', async () => {
    const x = await order();
    await prisma.order.update({ where: { id: x.id }, data: { pancakePushStatus: 'STALE', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' } });
    const pk = `pk-${randCode(8)}`;
    respond(() => ({ success: true, data: { id: pk } }));
    const callsOfX = () => client.createOrder.mock.calls.filter(([body]) => (body as { custom_id: string }).custom_id === x.code).length;
    await service.syncPayment(x.id);
    await service.enqueuePush(x.id);
    await service.enqueuePayment(x.id);
    await sleep(500);
    expect(callsOfX()).toBe(0);
    const stale = await prisma.order.findUniqueOrThrow({ where: { id: x.id } });
    expect(stale).toMatchObject({ pancakePushStatus: 'STALE', pancakeOrderId: null });
    expect(stale.pancakeAttention).toContain('quá hạn tự đẩy');

    await service.retryPushByAdmin('admin-it', x.code);
    await until(async () => (await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).pancakeOrderId === pk);
    expect(callsOfX()).toBe(1);
  });

  /** Lượt đẩy đang bay (createOrder chặn tại cổng); trong lúc đó đơn bị đánh STALE (như markStale của lượt khác), rồi lượt bay mới trả kết quả. */
  const staleWhileInFlight = async (inFlightError: () => Error, jobOpts: { attempts?: number; seed?: Record<string, unknown> } = {}) => {
    const x = await order();
    if (jobOpts.seed) await prisma.order.update({ where: { id: x.id }, data: jobOpts.seed });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    respond(async (code) => {
      if (code !== x.code) return { success: true, data: { id: `pk-${code}` } };
      n += 1;
      if (n === 1) {
        await gate;
        throw inFlightError();
      }
      return { success: true, data: { id: `pk-${code}` } };
    });
    if (jobOpts.attempts) await queue.add(PANCAKE_JOB_PUSH, { orderId: x.id }, { jobId: x.id, attempts: jobOpts.attempts });
    else await service.enqueuePush(x.id);
    await until(async () => n >= 1);
    await prisma.order.update({ where: { id: x.id }, data: { pancakePushStatus: 'STALE' } });
    release();
    await until(async () => {
      const st = await queue.getJob(x.id).then((j) => j?.getState());
      return st === 'completed' || st === 'failed';
    });
    await sleep(300);
    return { x, calls: () => n, row: () => prisma.order.findUniqueOrThrow({ where: { id: x.id } }) };
  };

  it('STALE giữa lúc lượt đẩy đang bay, lượt bay gặp 503, job thử lại: KHÔNG gọi createOrder lần hai, đơn vẫn STALE', async () => {
    const { calls, row } = await staleWhileInFlight(() => new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503));
    expect(calls()).toBe(1);
    expect(await row()).toMatchObject({ pancakePushStatus: 'STALE', pancakeOrderId: null });
  });

  it('STALE giữa lúc lượt đẩy đang bay, lượt bay gặp lỗi dứt khoát (422): vẫn STALE, không FAILED, không gọi lần hai', async () => {
    const { calls, row } = await staleWhileInFlight(() => new PancakeApiError('Pancake trả 422 khi tạo đơn: x', false, false, 422));
    expect(calls()).toBe(1);
    expect(await row()).toMatchObject({ pancakePushStatus: 'STALE', pancakeErrorKind: 'REJECTED', pancakeOrderId: null });
  });

  it('STALE giữa lúc lượt đẩy đang bay, lượt cuối của job gặp 503 (markPushFailure final): vẫn STALE, không FAILED', async () => {
    const { calls, row } = await staleWhileInFlight(() => new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503), { attempts: 1 });
    expect(calls()).toBe(1);
    expect(await row()).toMatchObject({ pancakePushStatus: 'STALE', pancakeOrderId: null });
  });

  it('STALE giữa lúc lượt đẩy đang bay, đơn có loại lỗi cũ cần giữ (REJECTED) gặp 503: câu ghi không còn trường nào mà vẫn chạy đúng trên Postgres, STALE và lời lỗi cũ còn nguyên', async () => {
    const { calls, row } = await staleWhileInFlight(() => new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503), {
      seed: { pancakeErrorKind: 'REJECTED', pancakeSyncError: 'Pancake trả 422 cũ' },
    });
    expect(calls()).toBe(1);
    expect(await row()).toMatchObject({ pancakePushStatus: 'STALE', pancakeErrorKind: 'REJECTED', pancakeSyncError: 'Pancake trả 422 cũ' });
  });

  it('markOverdue không đánh STALE đơn quá 72 giờ đang PUSHING trong hạn thuê quyền đẩy; hết hạn thuê thì lần quét sau mới đánh', async () => {
    const x = await order();
    // createdAt rất cũ để đơn đứng đầu lô markOverdue (xếp theo ngày đặt tăng dần) dù DB dùng chung có đơn quá hạn của spec khác.
    await prisma.order.update({ where: { id: x.id }, data: { createdAt: new Date('2000-01-01T00:00:00Z'), pancakePushStatus: 'PUSHING', pancakeLastAttemptAt: new Date() } });
    await reconcile.reconcile();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ pancakePushStatus: 'PUSHING', pancakeAttention: null });

    await prisma.order.update({ where: { id: x.id }, data: { pancakeLastAttemptAt: new Date(Date.now() - PancakeOrderService.PUSH_LEASE_MS - 5_000) } });
    await reconcile.reconcile();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ pancakePushStatus: 'STALE' });
  });
});
