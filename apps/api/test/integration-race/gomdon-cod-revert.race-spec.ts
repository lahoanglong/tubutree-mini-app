import type { Queue } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { COD_SWITCH_HISTORY_NOTE } from '../../src/modules/orders/cod-switch';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import { DEFAULT_GOMDON_WAREHOUSE } from '../../src/modules/integrations/gomdon/gomdon-config';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { ATTENTION_COD_SWITCH_PAID_AFTER_HANDOVER, PANCAKE_COD_SWITCH_PAID_NOTE } from '../../src/modules/integrations/pancake/pancake-attention';
import type { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import type { GomdonCreateOrderBody } from '../../src/modules/integrations/gomdon/gomdon.types';
import type { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

/**
 * Đua hẹp (review w23-04 MINOR #3, w29-01): job Gomdon tạo vận đơn thu hộ cho đơn khách đã đổi sang COD, cùng lúc tiền chuyển khoản cũ về và markPaid lật
 * đơn về chuyển khoản đã trả. Trên Postgres THẬT: vận đơn không bao giờ thu hộ đơn đã trả mà không ai được báo, và chỉ MỘT bên báo (khoá advisory chung
 * `lockCodCollect` giữa câu lật của markPaid và lần ghi mã vận đơn của job).
 */
describe('Gomdon COD waybill vs transfer arriving after COD switch (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let gomdon: GomdonOrderService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const created = { orderIds: [] as string[], userIds: [] as string[] };
  const client = {
    isConfigured: jest.fn().mockResolvedValue(true),
    isRecyclingEnabled: jest.fn().mockResolvedValue(true),
    getConfig: jest.fn(),
    createOrder: jest.fn(),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };
  const queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
  const pancake = { enqueuePush: jest.fn().mockResolvedValue(undefined), syncWaybillNote: jest.fn().mockResolvedValue(undefined) };
  let alertSpy: jest.SpyInstance;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    orderStatus = new OrderStatusService(
      prisma,
      { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
      { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService,
      notifications,
      reversal,
    );
    gomdon = new GomdonOrderService(
      prisma,
      client as unknown as GomdonClient,
      queue as unknown as Queue,
      pancake as unknown as PancakeOrderService,
      new GomdonAlertService(prisma, notifications),
    );
    (gomdon as unknown as { persistRetryDelayMs: number }).persistRetryDelayMs = 0;
  });

  afterAll(async () => {
    if (prisma) {
      const { orderIds, userIds } = created;
      await prisma.$transaction([
        prisma.gomdonAlert.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    // Mọi lời báo (của markPaid qua GomdonAlertService tự dựng, và của job) đi qua prototype này: đếm LẦN GỌI, không đếm dòng gomdon_alerts, vì dòng
    // trùng chữ bị gộp và sẽ che mất việc hai bên cùng báo.
    alertSpy = jest.spyOn(GomdonAlertService.prototype, 'alert');
    client.getConfig.mockReset().mockResolvedValue({ defaultWarehouse: DEFAULT_GOMDON_WAREHOUSE, defaultWeightFallback: 500 });
    client.createOrder.mockReset();
  });
  afterEach(() => alertSpy.mockRestore());

  /** Đơn thu gom khách đã đổi từ chuyển khoản sang COD, còn trong kho, chưa đặt bưu tá. */
  async function switchedRecyclingOrder() {
    const buyer = await createUser(prisma);
    created.userIds.push(buyer.id);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      hasRecyclingPickup: true,
      recyclingNote: 'IT cod revert',
      total: 250_000,
      subtotal: 250_000,
      items: {
        create: [{ variationId: `var-${randCode(6)}`, productName: 'San pham IT', variationName: '1kg', unitPrice: 250_000, quantity: 1, total: 250_000 }],
      },
    });
    created.orderIds.push(order.id);
    await prisma.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'CUSTOMER', note: COD_SWITCH_HISTORY_NOTE },
    });
    return order;
  }

  const waybillFor = (id: string) => ({ data: { id, partner_code: `BE${id}`, status: 1 } });
  const sentBody = (call = 0) => client.createOrder.mock.calls[call]![0] as GomdonCreateOrderBody;
  const collectAlerts = (code: string) => alertSpy.mock.calls.filter((c) => c[0] === code && String(c[1]).includes('còn thu hộ'));

  it('tiền về SAU lúc claim, TRƯỚC lúc ghi mã: job ghi mã thấy đơn đã trả và báo sửa thu hộ, đúng một lần, kèm mã vận đơn', async () => {
    const order = await switchedRecyclingOrder();
    const gid = `G${randCode(8)}`;
    let paid: string | null = null;
    client.createOrder.mockImplementation(async () => {
      // Đơn đang CREATING, chưa có mã: markPaid lật và commit ngay giữa lúc Gomdon đang tạo.
      paid = (await orderStatus.markPaid(order.id, { actorType: 'PANCAKE', note: 'IT' })).outcome;
      return waybillFor(gid);
    });

    expect(await gomdon.pushOrder(order.id)).toBe(`BE${gid}`);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(paid).toBe('PAID');
    expect(sentBody().collect_amount).toBe(250_000);
    expect(after).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', gomdonPartnerCode: `BE${gid}` });
    const alerts = collectAlerts(order.code);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![1]).toContain(`vận đơn Gomdon BE${gid} còn thu hộ`);
    expect(await prisma.gomdonAlert.count({ where: { orderId: order.id, resolvedAt: null } })).toBe(1);
  });

  it('tiền về TRƯỚC lúc claim (job đã dựng body thu hộ): claim hụt, dựng lại từ đơn mới, vận đơn thu hộ 0đ, không báo', async () => {
    const order = await switchedRecyclingOrder();
    const gid = `G${randCode(8)}`;
    // getConfig chạy đầu buildBody, sau lúc job đọc đơn còn COD: lần đầu chen markPaid vào giữa đọc và claim.
    client.getConfig.mockImplementationOnce(async () => {
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      return { defaultWarehouse: DEFAULT_GOMDON_WAREHOUSE, defaultWeightFallback: 500 };
    });
    client.createOrder.mockResolvedValue(waybillFor(gid));

    expect(await gomdon.pushOrder(order.id)).toBe(`BE${gid}`);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(sentBody().collect_amount).toBe(0);
    expect(after).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', gomdonPartnerCode: `BE${gid}` });
    expect(collectAlerts(order.code)).toHaveLength(0);
  });

  it('vận đơn ghi xong rồi tiền mới về: markPaid thấy mã vận đơn trong transaction lật và báo, job không báo thêm', async () => {
    const order = await switchedRecyclingOrder();
    const gid = `G${randCode(8)}`;
    client.createOrder.mockResolvedValue(waybillFor(gid));
    expect(await gomdon.pushOrder(order.id)).toBe(`BE${gid}`);
    expect(collectAlerts(order.code)).toHaveLength(0);

    expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
    const alerts = collectAlerts(order.code);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![1]).toContain(`vận đơn Gomdon BE${gid} còn thu hộ`);
  });

  it('markPaid đọc đơn lúc chưa có vận đơn, job ghi mã xong rồi markPaid mới lật: đọc lại trong transaction lật thấy mã và báo đúng một lần', async () => {
    const order = await switchedRecyclingOrder();
    const gid = `G${randCode(8)}`;
    client.createOrder.mockResolvedValue(waybillFor(gid));
    const original = prisma.order.findFirst.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snapshot = await original(args);
      // Ảnh chụp của markPaid chưa có vận đơn; job tạo và ghi mã xong (thấy đơn còn COD chưa trả nên không báo) trước câu lật.
      expect(await gomdon.pushOrder(order.id)).toBe(`BE${gid}`);
      return snapshot;
    }) as never);
    try {
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
    } finally {
      spy.mockRestore();
    }
    const alerts = collectAlerts(order.code);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![1]).toContain(`vận đơn Gomdon BE${gid} còn thu hộ`);
  });

  describe('webhook Pancake báo "đã trả" cho đơn đã đổi COD sau bàn giao (w23-04 MINOR #2, w23-02 cờ nhầm)', () => {
    const pancakeAlert = jest.fn().mockResolvedValue(undefined);
    let proc: { onPaymentReconcile(d: Record<string, unknown>): Promise<unknown> };
    beforeAll(() => {
      proc = new PancakeProcessor(prisma, { notify, notifySafe: notify } as unknown as NotificationsService, orderStatus, {
        alert: pancakeAlert,
      } as never) as unknown as typeof proc;
    });
    beforeEach(() => pancakeAlert.mockClear());

    async function handedOver(status: 'SHIPPING' | 'DELIVERED') {
      const order = await switchedRecyclingOrder();
      const pancakeOrderId = `PCIT${randCode(8)}`;
      await prisma.order.update({ where: { id: order.id }, data: { status, shippedAt: new Date(), pancakeOrderId } });
      return { order, pancakeOrderId };
    }

    it('hàng đang giao, 5 webhook cùng mang cờ is_paid ĐỒNG THỜI: đúng một dấu lịch sử, một lời "Cần xử lý", một lần báo; đơn không lật', async () => {
      const { order, pancakeOrderId } = await handedOver('SHIPPING');
      const runs = await Promise.allSettled(Array.from({ length: 5 }, () => proc.onPaymentReconcile({ id: pancakeOrderId, is_paid: true, status: 2 })));
      expect(summarize(runs).rejected).toHaveLength(0);

      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID' });
      expect(after.pancakeAttention).toContain(ATTENTION_COD_SWITCH_PAID_AFTER_HANDOVER);
      expect(after.pancakeAttention).toContain('không kèm số tiền');
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, note: { startsWith: PANCAKE_COD_SWITCH_PAID_NOTE } } })).toBe(1);
      expect(pancakeAlert).toHaveBeenCalledTimes(1);

      // Kho bấm "Đã xử lý" (ô trống), Pancake gửi lại cùng cờ ở webhook sau: không nhắc lại.
      await prisma.order.update({ where: { id: order.id }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
      await proc.onPaymentReconcile({ id: pancakeOrderId, is_paid: true, status: 2 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention).toBeNull();
      expect(pancakeAlert).toHaveBeenCalledTimes(1);
    });

    it('hãng đã giao và thu COD (Pancake ghi is_paid + prepaid bằng tổng đơn): không nhắc nhầm; ghi thêm bank_payment thì nhắc', async () => {
      const { order, pancakeOrderId } = await handedOver('DELIVERED');
      await proc.onPaymentReconcile({ id: pancakeOrderId, is_paid: true, prepaid: 250_000, status: 16 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention ?? '').not.toContain(ATTENTION_COD_SWITCH_PAID_AFTER_HANDOVER);
      expect(pancakeAlert).not.toHaveBeenCalled();

      await proc.onPaymentReconcile({ id: pancakeOrderId, is_paid: true, prepaid: 250_000, bank_payment: 250_000, status: 16 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention).toContain('250.000đ chuyển khoản');
      expect(pancakeAlert).toHaveBeenCalledTimes(1);
    });
  });

  it('8 đơn, job tạo vận đơn và tiền về ĐỒNG THỜI: vận đơn thu hộ đơn đã trả thì báo đúng một lần, thu hộ 0đ thì không báo', async () => {
    const orders = await Promise.all(Array.from({ length: 8 }, () => switchedRecyclingOrder()));
    client.createOrder.mockImplementation(async (body: GomdonCreateOrderBody) => {
      await sleep(5 + Math.floor(Math.random() * 30));
      return waybillFor(`G${body.order_customer_id}`);
    });

    const runs = await Promise.allSettled(
      orders.flatMap((o) => [
        gomdon.pushOrder(o.id),
        sleep(Math.floor(Math.random() * 40)).then(() => orderStatus.markPaid(o.id, { actorType: 'PANCAKE' })),
      ]),
    );
    const s = summarize(runs);
    expect(s.rejected).toHaveLength(0);

    let collecting = 0;
    for (const o of orders) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      const bodies = client.createOrder.mock.calls.map((c) => c[0] as GomdonCreateOrderBody).filter((b) => b.order_customer_id.startsWith(o.code));
      expect(bodies).toHaveLength(1);
      expect(after).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
      expect(after.gomdonPartnerCode).not.toBeNull();
      const expected = bodies[0]!.collect_amount > 0 ? 1 : 0;
      collecting += expected;
      expect(collectAlerts(o.code)).toHaveLength(expected);
    }
    console.log('[cod-revert x8] vận đơn tạo lúc còn COD (có báo) = %d / 8', collecting);
  });
});
