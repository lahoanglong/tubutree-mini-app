import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ATTENTION_TOTAL_MISMATCH } from '../../src/modules/integrations/pancake/pancake-attention';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * D1-03: webhook đơn Pancake mang tổng tiền khác `order.total` (đơn bị sửa trên Pancake) → "Cần xử lý Pancake" kèm số lệch,
 * KHÔNG sửa đơn Tubu. Chạy PancakeProcessor thật trên Postgres thật.
 */
describe('Pancake webhook: lệch tổng tiền (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
  let orderStatus: OrderStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn() } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn(),
      grantReferralReward: jest.fn(),
      reverseCommissionsForOrder: jest.fn(),
    } as unknown as AffiliateService;
    const notifications = { notify } as unknown as NotificationsService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, new AnalyticsEventsService(prisma));
    processor = new PancakeProcessor(prisma, notifications, orderStatus, undefined, new SystemConfigService(prisma));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seed(opts: { merchantLine?: boolean } = {}) {
    const tag = randCode(8);
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', total: 269_000, subtotal: 250_000, shippingFee: 19_000, pancakeOrderId: `pc-${tag}` });
    const product = await prisma.product.create({
      data: { pancakeId: `it-tm-p-${tag}`, brand: 'IT', slug: `it-tm-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 125_000 },
    });
    const variation = await prisma.variation.create({
      data: { pancakeId: `it-tm-v-${tag}`, productId: product.id, sku: `TM-${tag}`, name: 'v', attributes: {}, retailPrice: 125_000, stock: 9 },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, variationId: variation.id, productName: product.name, variationName: 'v', unitPrice: 125_000, quantity: 2, total: 250_000 },
    });
    if (opts.merchantLine) {
      const mp = await prisma.product.create({
        data: { pancakeId: `it-tm-mp-${tag}`, brand: 'IT', slug: `it-tm-m-${tag.toLowerCase()}`, name: `Đối tác ${tag}`, description: 'IT', basePrice: 50_000, fulfilment: 'MERCHANT' },
      });
      const mv = await prisma.variation.create({
        data: { productId: mp.id, sku: `TMM-${tag}`, name: 'v', attributes: {}, retailPrice: 50_000, stock: 9 },
      });
      await prisma.orderItem.create({
        data: { orderId: order.id, variationId: mv.id, productName: mp.name, variationName: 'v', unitPrice: 50_000, quantity: 1, total: 50_000 },
      });
    }
    return order;
  }

  const payload = (order: { code: string; pancakeOrderId: string | null }, over: Record<string, unknown> = {}) => ({
    id: order.pancakeOrderId,
    status: 1,
    custom_id: order.code,
    total_price: 280_000,
    total_price_after_sub_discount: 250_000,
    total_discount: 30_000,
    shipping_fee: 19_000,
    cod: 269_000,
    ...over,
  });
  const EDITED = { total_price: 330_000, total_price_after_sub_discount: 300_000, cod: 319_000 };

  async function deliver(body: Record<string, unknown>) {
    const ev = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'order.updated', rawPayload: body as object, status: 'PENDING' } });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
  }
  const reload = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

  it('đơn bị sửa trên Pancake: vào hàng đợi kèm hai số và chênh lệch; đơn Tubu giữ nguyên tổng; gửi lại cùng số không ghi lại', async () => {
    const order = await seed();
    const ev = await deliver(payload(order, EDITED));
    expect(ev.status).toBe('PROCESSED');
    const after = await reload(order.id);
    expect(after.pancakeAttention).toContain(ATTENTION_TOTAL_MISMATCH);
    expect(after.pancakeAttention).toContain('Pancake ghi 319.000đ');
    expect(after.pancakeAttention).toContain('+50.000đ');
    expect(after).toMatchObject({ total: 269_000, subtotal: 250_000, shippingFee: 19_000, status: 'CONFIRMED', paymentStatus: 'UNPAID' });
    const at = after.pancakeAttentionAt;
    expect(at).not.toBeNull();

    await deliver(payload(order, EDITED));
    expect((await reload(order.id)).pancakeAttentionAt).toEqual(at);
  });

  it('sửa lại đúng số trên Pancake: lời nhắc tự gỡ', async () => {
    const order = await seed();
    await deliver(payload(order, EDITED));
    expect((await reload(order.id)).pancakeAttention).toContain(ATTENTION_TOTAL_MISMATCH);
    await deliver(payload(order));
    expect(await reload(order.id)).toMatchObject({ pancakeAttention: null, pancakeAttentionAt: null });
  });

  it('đơn nguyên vẹn và đơn có dòng đối tác tự giao đều không bị báo; đang chờ lý do khác thì không bị ghi đè', async () => {
    const intact = await seed();
    await deliver(payload(intact));
    expect((await reload(intact.id)).pancakeAttention).toBeNull();

    const mixed = await seed({ merchantLine: true });
    await deliver(payload(mixed, EDITED));
    expect((await reload(mixed.id)).pancakeAttention).toBeNull();

    const busy = await seed();
    await prisma.order.update({ where: { id: busy.id }, data: { pancakeAttention: 'Khách chuyển thiếu: 1/2', pancakeAttentionAt: new Date() } });
    await deliver(payload(busy, EDITED));
    expect((await reload(busy.id)).pancakeAttention).toBe('Khách chuyển thiếu: 1/2');
  });

  it('job khác ghi lý do vào đơn SAU khi so tổng đã đọc đơn (đọc thấy chưa có lý do): lý do của job đó còn nguyên, không bị đè', async () => {
    const order = await seed();
    const other = 'Khách chuyển thiếu: 1/2';
    const original = prisma.order.findFirst.bind(prisma.order);
    let injected = false;
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementation((async (args: Parameters<typeof original>[0]) => {
      const row = await original(args);
      if (!injected && new Error().stack?.includes('reconcileTotal')) {
        injected = true;
        await prisma.order.update({ where: { id: order.id }, data: { pancakeAttention: other, pancakeAttentionAt: new Date() } });
      }
      return row;
    }) as never);
    try {
      await deliver(payload(order, EDITED));
    } finally {
      spy.mockRestore();
    }
    expect(injected).toBe(true);
    expect((await reload(order.id)).pancakeAttention).toBe(other);
  });

  it('đơn đã huỷ không báo; công tắc pancake.total_mismatch_check=false tắt việc so, bật lại thì so như thường', async () => {
    const cancelled = await seed();
    await prisma.order.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED', paymentStatus: 'REFUNDED' } });
    await deliver(payload(cancelled, { ...EDITED, status: 1 }));
    expect((await reload(cancelled.id)).pancakeAttention).toBeNull();

    await setConfig(prisma, 'pancake.total_mismatch_check', false);
    try {
      const off = new PancakeProcessor(prisma, { notify } as unknown as NotificationsService, orderStatus, undefined, new SystemConfigService(prisma));
      const order = await seed();
      const ev = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'order.updated', rawPayload: payload(order, EDITED) as object, status: 'PENDING' } });
      await off.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
      expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('PROCESSED');
      expect((await reload(order.id)).pancakeAttention).toBeNull();

      await setConfig(prisma, 'pancake.total_mismatch_check', true);
      const on = new PancakeProcessor(prisma, { notify } as unknown as NotificationsService, orderStatus, undefined, new SystemConfigService(prisma));
      const ev2 = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'order.updated', rawPayload: payload(order, EDITED) as object, status: 'PENDING' } });
      await on.process({ data: { eventId: ev2.id } } as Job<{ eventId: string }>);
      expect((await reload(order.id)).pancakeAttention).toContain(ATTENTION_TOTAL_MISMATCH);
    } finally {
      await prisma.systemConfig.delete({ where: { key: 'pancake.total_mismatch_check' } }).catch(() => undefined);
    }
  });
});
