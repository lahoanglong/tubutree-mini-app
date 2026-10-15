import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QUEUE_GOMDON_EVENTS, QUEUE_GOMDON_PUSH } from '../../src/jobs/queues';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonWebhookService } from '../../src/modules/integrations/gomdon/gomdon-webhook.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import { DEFAULT_GOMDON_WAREHOUSE } from '../../src/modules/integrations/gomdon/gomdon-config';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { barrierOnFirstCalls, createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

const mockQueue = () => ({
  getJob: jest.fn().mockResolvedValue(null),
  add: jest.fn().mockResolvedValue({}),
});

/**
 * Gomdon: claim nguyên tử trước khi tạo vận đơn + dedupe webhook, trên Postgres thật.
 * Stub: GomdonClient (HTTP), BullMQ queues, Pancake, alert CSKH, OrderStatusService.
 */
describe('Gomdon race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let gomdonOrder: GomdonOrderService;
  let webhook: GomdonWebhookService;

  const pushQueue = mockQueue();
  const eventsQueue = mockQueue();
  const pancake = { enqueuePush: jest.fn().mockResolvedValue(undefined) };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined), resolveKinds: jest.fn().mockResolvedValue(0) };
  const client = {
    isConfigured: jest.fn().mockResolvedValue(true),
    isRecyclingEnabled: jest.fn().mockResolvedValue(true),
    getConfig: jest.fn().mockResolvedValue({
      defaultWarehouse: DEFAULT_GOMDON_WAREHOUSE,
      defaultWeightFallback: 500,
    }),
    createOrder: jest.fn(),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        GomdonOrderService,
        GomdonWebhookService,
        { provide: GomdonClient, useValue: client },
        { provide: getQueueToken(QUEUE_GOMDON_PUSH), useValue: pushQueue },
        { provide: getQueueToken(QUEUE_GOMDON_EVENTS), useValue: eventsQueue },
        { provide: PancakeOrderService, useValue: pancake },
        { provide: GomdonAlertService, useValue: alerts },
        { provide: OrderStatusService, useValue: { setStatus: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    gomdonOrder = moduleRef.get(GomdonOrderService);
    webhook = moduleRef.get(GomdonWebhookService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    client.createOrder.mockReset();
    pancake.enqueuePush.mockClear();
    alerts.alert.mockClear();
  });

  const recyclingCodOrder = async () => {
    const buyer = await createUser(prisma);
    return createOrder(prisma, {
      userId: buyer.id,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      hasRecyclingPickup: true,
      recyclingNote: 'IT race',
      total: 250_000,
      subtotal: 250_000,
      items: {
        create: [
          {
            variationId: `var-${randCode(6)}`,
            productName: 'San pham IT',
            variationName: '1kg',
            unitPrice: 250_000,
            quantity: 1,
            total: 250_000,
          },
        ],
      },
    });
  };

  const slowCreate = (id: string) =>
    client.createOrder.mockImplementation(async () => {
      await sleep(200);
      return { data: { id, partner_code: `BE${id}`, status: 1 } };
    });

  it('(f) pushOrder: 3 concurrent calls on a COD recycling order -> createOrder called once, one gomdonOrderId', async () => {
    const order = await recyclingCodOrder();
    const gid = `G${randCode(8)}`;
    slowCreate(gid);

    // Rào chắn: cả 3 cùng đọc đơn (gomdonStatus=null) trước khi ai kịp claim → cả 3 tới bước
    // claim updateMany; chỉ guard nguyên tử của DB quyết định ai được gọi Gomdon.
    const gate = barrierOnFirstCalls(prisma.order, 'findUniqueOrThrow', 3);
    const claimSpy = jest.spyOn(prisma.order, 'updateMany');
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => gomdonOrder.pushOrder(order.id)));
    gate.mockRestore();
    const claimAttempts = claimSpy.mock.calls.filter(
      (c) => (c[0] as { data?: { gomdonStatus?: string } })?.data?.gomdonStatus === 'CREATING',
    ).length;
    claimSpy.mockRestore();
    const s = summarize(results);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[f] claimAttempts=%d createOrder calls=%d returns=%j gomdonOrderId=%s partner=%s gomdonStatus=%s alerts=%d errors=%j',
      claimAttempts,
      client.createOrder.mock.calls.length,
      s.fulfilled.map((f) => f.value),
      fresh.gomdonOrderId,
      fresh.gomdonPartnerCode,
      fresh.gomdonStatus,
      alerts.alert.mock.calls.length,
      s.errors,
    );

    expect(s.rejected).toHaveLength(0);
    expect(claimAttempts).toBe(3); // cả 3 tới bước claim → guard DB thật sự được thử thách
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(alerts.alert).not.toHaveBeenCalled();
    expect(fresh.gomdonOrderId).toBe(gid);
    expect(fresh.gomdonPartnerCode).toBe(`BE${gid}`);
    expect(fresh.shippingCode).toBe(`BE${gid}`);
    expect(s.fulfilled.filter((f) => f.value === `BE${gid}`)).toHaveLength(1);
    expect(fresh.gomdonStatus).toBe('1');
  });

  it('(f-staggered, informational) pushOrder: 2nd call arrives WHILE createOrder is in flight -> still one waybill', async () => {
    const order = await recyclingCodOrder();
    const gid = `G${randCode(8)}`;
    slowCreate(gid);

    const first = gomdonOrder.pushOrder(order.id);
    await sleep(80); // lần 1 đã claim CREATING, đang chờ Gomdon trả lời
    const second = gomdonOrder.pushOrder(order.id);
    const results = await Promise.allSettled([first, second]);
    const s = summarize(results);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[f-staggered] createOrder calls=%d returns=%j gomdonOrderId=%s gomdonStatus=%s alerts=%j pancakePushes=%d',
      client.createOrder.mock.calls.length,
      s.fulfilled.map((f) => f.value),
      fresh.gomdonOrderId,
      fresh.gomdonStatus,
      alerts.alert.mock.calls.map((c) => String(c[1]).slice(0, 90)),
      pancake.enqueuePush.mock.calls.length,
    );

    // Bất biến tiền/kho: không bao giờ tạo 2 vận đơn, mã vận đơn không bị mất.
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(fresh.gomdonOrderId).toBe(gid);
    expect(fresh.gomdonPartnerCode).toBe(`BE${gid}`);
  });

  it('(g) webhook receive: same payload 5x concurrently -> 1 gomdon_webhook_events row', async () => {
    const gid = `W${randCode(8)}`;
    const payload = {
      order_id: gid,
      order_code: `BE${gid}`,
      order_customer_id: `TUBU${randCode(8)}`,
      status: 3,
      created_time: 1790000000,
    };

    const insertSpy = jest.spyOn(prisma.gomdonWebhookEvent, 'create');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => webhook.receive({ ...payload })));
    const inserts = insertSpy.mock.calls.length;
    insertSpy.mockRestore();
    const s = summarize(results);
    const rows = await prisma.gomdonWebhookEvent.findMany({ where: { gomdonOrderId: gid } });

    // eslint-disable-next-line no-console
    console.log(
      '[g] fulfilled=%d rejected=%d insertsAttempted=%d rows=%d enqueues=%d jobIds=%j errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      inserts,
      rows.length,
      eventsQueue.add.mock.calls.length,
      [...new Set(eventsQueue.add.mock.calls.map((c) => (c[2] as { jobId?: string })?.jobId))],
      s.errors,
    );

    expect(s.rejected).toHaveLength(0);
    expect(inserts).toBe(5); // không có pre-check: cả 5 INSERT, unique dedupeKey chặn 4
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('RECEIVED');
    // Mọi lần enqueue (nếu có nhiều) đều dùng CÙNG jobId = event id → BullMQ tự dedupe.
    const jobIds = new Set(eventsQueue.add.mock.calls.map((c) => (c[2] as { jobId?: string })?.jobId));
    expect(jobIds).toEqual(new Set([rows[0]!.id]));
  });

  it('(h) UAT GOMDON-3: kho giao bằng hãng khác GIỮA lúc đọc đơn và lúc claim -> không tạo vận đơn Gomdon; lần sau chốt FAILED + báo', async () => {
    const order = await recyclingCodOrder();
    client.createOrder.mockResolvedValue({ data: { id: 'SHOULD-NOT', partner_code: 'BESHOULD-NOT', status: 1 } });

    const original = prisma.order.findUniqueOrThrow.bind(prisma.order);
    const readSpy = jest.spyOn(prisma.order, 'findUniqueOrThrow').mockImplementationOnce((async (args: unknown) => {
      const snapshot = await original(args as Parameters<typeof original>[0]);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'SHIPPING', shippingCode: 'GHN123', shippingPartner: 'GHN' },
      });
      return snapshot;
    }) as never);
    const first = await gomdonOrder.pushOrder(order.id);
    readSpy.mockRestore();
    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    const second = await gomdonOrder.pushOrder(order.id);
    const afterSecond = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[h] createOrder calls=%d first=%s afterFirst=%s second=%s afterSecond=%s alerts=%j',
      client.createOrder.mock.calls.length,
      first,
      afterFirst.gomdonStatus,
      second,
      afterSecond.gomdonStatus,
      alerts.alert.mock.calls.map((c) => String(c[1]).slice(0, 60)),
    );

    expect(client.createOrder).not.toHaveBeenCalled();
    expect(first).toBeNull();
    expect(afterFirst.gomdonStatus).toBeNull();
    expect(afterFirst.gomdonOrderId).toBeNull();
    expect(second).toBeNull();
    expect(afterSecond.gomdonStatus).toBe('FAILED');
    expect(afterSecond.shippingCode).toBe('GHN123');
    expect(alerts.alert).toHaveBeenCalledTimes(1);
    expect(String(alerts.alert.mock.calls[0]![1])).toContain('KHÔNG tạo vận đơn Gomdon');
  });
});

/** Báo động lưu DB: job chạy chồng / webhook gửi lại cùng lúc không được tạo nhiều báo động giống nhau. */
describe('GomdonAlertService race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let alertService: GomdonAlertService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [GomdonAlertService, { provide: NotificationsService, useValue: notifications }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    alertService = moduleRef.get(GomdonAlertService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('(i) UAT GOMDON-2: cùng báo động 5 lần đồng thời -> 1 dòng gomdon_alerts đang mở; đóng rồi báo lại -> dòng mới', async () => {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, hasRecyclingPickup: true });
    const message = 'Gomdon CÓ vận đơn BE1 — kiểm tra ngay tránh giao trùng 2 vận đơn.';

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => alertService.alert(order.code, message)));
    const s = summarize(results);
    const open = await prisma.gomdonAlert.findMany({ where: { orderId: order.id, resolvedAt: null } });

    // eslint-disable-next-line no-console
    console.log('[i] fulfilled=%d rejected=%d openRows=%d', s.fulfilled.length, s.rejected.length, open.length);

    expect(s.rejected).toHaveLength(0);
    expect(open).toHaveLength(1);

    expect(await alertService.resolveOpenForOrder(order.id)).toBe(1);
    await alertService.alert(order.code, message);
    const all = await prisma.gomdonAlert.findMany({ where: { orderId: order.id } });
    expect(all).toHaveLength(2);
    expect(all.filter((a) => a.resolvedAt === null)).toHaveLength(1);
  });
});
