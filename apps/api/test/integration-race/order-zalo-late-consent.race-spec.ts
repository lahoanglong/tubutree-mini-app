import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { MssFlagsService } from '../../src/modules/integrations/mss/mss-flags';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import type { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssOrderEventDispatcher } from '../../src/modules/integrations/mss/mss-order-event.dispatch';
import { MssOrderEventRecorder } from '../../src/modules/integrations/mss/mss-order-event.recorder';
import { ORDER_ZALO_CONSENT_TEXT_VERSION } from '../../src/modules/integrations/mss/mss-order-event-types';
import { OrdersService } from '../../src/modules/orders/orders.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createOrder, createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

/**
 * Bật tin hành trình qua Zalo từ chi tiết đơn trên Postgres THẬT: idempotent khi bấm đúp và khi nhiều yêu cầu cùng lúc, sự kiện trước
 * lúc đồng ý không được ghi và không gửi bù, sự kiện sau đó ghi đúng một dòng mỗi (orderId, eventType), khách khác 404, đơn đã kết thúc
 * 409, cờ MSS tắt thì không ghi gì. MSS giả: không gọi mạng, dispatcher chỉ đếm.
 */
describe('Đồng ý Zalo muộn ở chi tiết đơn (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  let variationId: string;

  const flags = (on: boolean) =>
    ({ isEnabled: async () => on, configured: () => true, snapshot: async () => ({ orderEventsRolloutPct: 100 }) }) as unknown as MssFlagsService;
  const health = { assertCapability: async () => true } as unknown as MssHealthService;
  const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
  const dispatcher = { enqueue: () => undefined } as unknown as MssOrderEventDispatcher;
  const config = { get: async (k: string, fb?: unknown) => (k === 'orders.timeline_v2_enabled' ? true : fb) } as unknown as SystemConfigService;

  let recorder: MssOrderEventRecorder;
  let recorderOff: MssOrderEventRecorder;
  let orders: OrdersService;
  let ordersOff: OrdersService;

  const svc = (r: MssOrderEventRecorder) =>
    new OrdersService(prisma, {} as never, {} as never, {} as never, config, {} as never, {} as never, undefined, undefined, undefined, undefined, r);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const tag = randCode(6);
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itzalo-${tag}`,
        name: `Hàng Zalo ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITZALO-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(product.id);
    variationId = product.variations[0]!.id;
    recorder = new MssOrderEventRecorder(flags(true), health, circuitClient, dispatcher);
    recorderOff = new MssOrderEventRecorder(flags(false), health, circuitClient, dispatcher);
    await recorder.refreshGate();
    await recorderOff.refreshGate();
    orders = svc(recorder);
    ordersOff = svc(recorderOff);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.$disconnect();
  });

  /** Khách đã bỏ tick ở thanh toán: đơn không có đồng ý, lựa chọn gần nhất của khách là "không". */
  async function unconsentedOrder(status: 'CONFIRMED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED' = 'CONFIRMED') {
    const phone = uniquePhone('09');
    const user = await createUser(prisma, {
      phone,
      fullName: 'Trần Văn Bình',
      notifyOrderZalo: false,
      notifyOrderZaloAt: new Date('2026-11-01T00:00:00Z'),
      notifyOrderZaloSource: 'checkout',
    });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      status,
      platform: 'web',
      orderZaloConsent: false,
      shippingAddress: { recipient: 'Bình', phone, street: '1 IT', ward: 'P', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    await prisma.orderItem.create({ data: { orderId: order.id, variationId, productName: 'Nước giặt Fuwa3e 2L', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } });
    return { user, order };
  }

  const recordIn = (orderId: string, type: Parameters<MssOrderEventRecorder['record']>[2]) => prisma.$transaction((tx) => recorder.record(tx, orderId, type));
  const outbox = (orderId: string) => prisma.mssOrderEventOutbox.findMany({ where: { orderId } });

  it('sự kiện trước lúc đồng ý không được ghi, bật rồi không gửi bù; sự kiện sau đó ghi đúng một dòng dù ghi song song', async () => {
    const { order, user } = await unconsentedOrder('CONFIRMED');
    expect(await recordIn(order.id, 'order.created')).toBe('no_consent');
    await expect(orders.enableOrderZalo(user.id, order.code)).resolves.toEqual({ orderZaloConsent: true });
    expect(await outbox(order.id)).toHaveLength(0);
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { orderZaloConsent: true, orderZaloConsentAt: true, orderZaloConsentSource: true },
    });
    expect(after).toMatchObject({ orderZaloConsent: true, orderZaloConsentSource: 'order_detail' });
    expect(after.orderZaloConsentAt).toBeInstanceOf(Date);
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notifyOrderZalo: true, notifyOrderZaloSource: true, notifyOrderZaloTextVersion: true },
    });
    expect(u).toEqual({ notifyOrderZalo: true, notifyOrderZaloSource: 'order_detail', notifyOrderZaloTextVersion: ORDER_ZALO_CONSENT_TEXT_VERSION });

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => recordIn(order.id, 'order.shipping')));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await outbox(order.id);
    expect(rows.map((r) => r.eventType)).toEqual(['order.shipping']);
    expect(JSON.parse(rows[0]!.body).consent.source).toBe('checkout');
  });

  it('đơn đặt lúc cổng MSS đóng (nguồn gate_closed, đồng ý để trống): cổng mở rồi khách vẫn bật muộn được, nguồn thành order_detail, sự kiện sau đó ghi', async () => {
    const { order, user } = await unconsentedOrder('CONFIRMED');
    await prisma.order.update({ where: { id: order.id }, data: { orderZaloConsent: null } });
    await prisma.$transaction((tx) => recorderOff.onOrdersPlaced(tx, [{ id: order.id, userId: user.id, paymentStatus: 'UNPAID', paymentMethod: 'COD' }], true));
    const consentOf = () => prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { orderZaloConsent: true, orderZaloConsentSource: true } });
    expect(await consentOf()).toEqual({ orderZaloConsent: null, orderZaloConsentSource: 'gate_closed' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).notifyOrderZalo).toBe(false);

    expect((await orders.detailView(user.id, order.code)).orderZaloAvailable).toBe(true);
    await expect(orders.enableOrderZalo(user.id, order.code)).resolves.toEqual({ orderZaloConsent: true });
    expect(await consentOf()).toEqual({ orderZaloConsent: true, orderZaloConsentSource: 'order_detail' });
    expect(await recordIn(order.id, 'order.shipping')).toBeNull();
    expect((await outbox(order.id)).map((r) => r.eventType)).toEqual(['order.shipping']);
  });

  it('bấm đúp và 6 yêu cầu đồng thời: mọi yêu cầu thành công, đồng ý ghi một lần (mốc giờ không bị ghi lại)', async () => {
    const { order, user } = await unconsentedOrder('SHIPPING');
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => orders.enableOrderZalo(user.id, order.code)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill('fulfilled'));
    const first = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { orderZaloConsentAt: true } });
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyOrderZaloAt: true } });
    await new Promise((r) => setTimeout(r, 20));
    await expect(orders.enableOrderZalo(user.id, order.code)).resolves.toEqual({ orderZaloConsent: true });
    const again = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { orderZaloConsentAt: true } });
    const againUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyOrderZaloAt: true } });
    expect(again.orderZaloConsentAt).toEqual(first.orderZaloConsentAt);
    expect(againUser.notifyOrderZaloAt).toEqual(firstUser.notifyOrderZaloAt);
    expect(await outbox(order.id)).toHaveLength(0);
  });

  it('đơn tặng, tài khoản chưa xác minh SĐT (PO A2): bật muộn được; tin sau đó gửi về số tài khoản với nguồn checkout_contact, không gửi số người nhận', async () => {
    const own = uniquePhone('09');
    const giftee = uniquePhone('08');
    const user = await createUser(prisma, { phone: own, phoneVerifiedAt: null, fullName: 'Trần Văn Bình', notifyOrderZalo: false, notifyOrderZaloSource: 'checkout' });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      platform: 'web',
      orderZaloConsent: false,
      shippingAddress: { recipient: 'Bà Ngoại', phone: giftee, street: '1 IT', ward: 'P', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    await prisma.orderItem.create({ data: { orderId: order.id, variationId, productName: 'Nước giặt Fuwa3e 2L', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } });
    await orders.enableOrderZalo(user.id, order.code);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(true);
    expect(await recordIn(order.id, 'order.shipping')).toBeNull();
    const rows = await outbox(order.id);
    expect(rows.map((r) => [r.eventType, r.recipientRole])).toEqual([['order.shipping', 'buyer']]);
    const recipient = (JSON.parse(rows[0]!.body) as { recipient: Record<string, unknown> }).recipient;
    expect(recipient).toMatchObject({ phone: own, phone_source: 'checkout_contact' });
    expect(recipient).not.toHaveProperty('role');
  });

  it('tài khoản không có số và địa chỉ không có số đọc được: 409, không ghi gì', async () => {
    const user = await createUser(prisma, { fullName: 'Trần Văn Bình', notifyOrderZalo: false, notifyOrderZaloSource: 'checkout' });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      platform: 'web',
      orderZaloConsent: false,
      shippingAddress: { recipient: 'Bình', phone: '12345', street: '1 IT', ward: 'P', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    const err = await orders.enableOrderZalo(user.id, order.code).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).notifyOrderZalo).toBe(false);
  });

  it('khách khác gọi: 404, không ghi gì', async () => {
    const { order } = await unconsentedOrder('CONFIRMED');
    const other = await createUser(prisma, { phone: uniquePhone('09') });
    userIds.push(other.id);
    await expect(orders.enableOrderZalo(other.id, order.code)).rejects.toBeInstanceOf(NotFoundException);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).notifyOrderZalo).not.toBe(true);
  });

  it.each(['DELIVERED', 'CANCELLED'] as const)('đơn %s: 409 lời rõ, không ghi gì', async (status) => {
    const { order, user } = await unconsentedOrder(status);
    const err = await orders.enableOrderZalo(user.id, order.code).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/đã kết thúc/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).notifyOrderZalo).toBe(false);
  });

  it('bật cùng lúc đơn chuyển Đã giao: hoặc bật trước khi giao, hoặc 409 và không ghi', async () => {
    const { order, user } = await unconsentedOrder('SHIPPING');
    const [enable] = await Promise.allSettled([
      orders.enableOrderZalo(user.id, order.code),
      prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredEffectsAt: new Date() } }),
    ]);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, orderZaloConsent: true } });
    expect(after.status).toBe('DELIVERED');
    if (enable.status === 'fulfilled') expect(after.orderZaloConsent).toBe(true);
    else {
      expect(enable.reason).toBeInstanceOf(ConflictException);
      expect(after.orderZaloConsent).toBe(false);
    }
  });

  it('cờ MSS tắt: endpoint 404 và không ghi gì; chi tiết đơn không có tin và không có nút', async () => {
    const { order, user } = await unconsentedOrder('SHIPPING');
    await expect(ordersOff.enableOrderZalo(user.id, order.code)).rejects.toBeInstanceOf(NotFoundException);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderZaloConsent).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).notifyOrderZalo).toBe(false);
    const view = await ordersOff.detailView(user.id, order.code);
    expect(view).toMatchObject({ notices: [], orderZaloAvailable: false });
  });

  it('chi tiết đơn: có nút trước khi bật, mất nút sau khi bật; tin đã gửi chỉ có sự kiện, kênh, giờ; khách tắt ở Cài đặt thì hết dòng "Sẽ báo qua Zalo" và bộ ghi bỏ qua', async () => {
    const { order, user } = await unconsentedOrder('SHIPPING');
    expect((await orders.detailView(user.id, order.code)).orderZaloAvailable).toBe(true);
    await orders.enableOrderZalo(user.id, order.code);
    expect(await recordIn(order.id, 'order.shipping')).toBeNull();
    const resultAt = new Date('2026-11-18T07:02:00.000Z');
    await prisma.mssOrderEventOutbox.updateMany({ where: { orderId: order.id }, data: { status: 'RESULT_SENT', resultAt, resultReason: 'internal-note' } });
    const view = await orders.detailView(user.id, order.code);
    expect(view.orderZaloAvailable).toBe(false);
    expect(view.orderZaloOn).toBe(true);
    expect(view.notices).toEqual([{ event: 'order.shipping', channel: 'ZALO', at: resultAt.toISOString() }]);

    await prisma.user.update({ where: { id: user.id }, data: { notifyOrderZalo: false, notifyOrderZaloSource: 'account_settings' } });
    expect(await recordIn(order.id, 'order.delivered')).toBe('no_consent');
    expect(await orders.detailView(user.id, order.code)).toMatchObject({ orderZaloOn: false, orderZaloAvailable: false });
  });
});
