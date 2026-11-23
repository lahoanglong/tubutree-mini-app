import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderCodSwitchService } from '../../src/modules/orders/order-cod-switch.service';
import { COD_SWITCH_HISTORY_NOTE, COD_SWITCH_REFUSED, COD_SWITCH_REVERTED_NOTE } from '../../src/modules/orders/cod-switch';
import { refundReportedUnderpayment } from '../../src/modules/orders/refund-queue';
import { AdminService } from '../../src/modules/admin/admin.service';
import { GOMDON_STATE } from '../../src/modules/integrations/gomdon/gomdon-status';
import { ATTENTION_COD_SWITCH_REVERTED_CHECK_WAYBILL } from '../../src/modules/integrations/pancake/pancake-attention';
import { PENDING_PAYMENT_TTL_KEY, PendingPaymentExpiryCron } from '../../src/modules/orders/pending-payment-expiry.cron';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { GuestCheckoutService } from '../../src/modules/checkout/guest/guest-checkout.service';
import { GUEST_COD_MAX_KEY } from '../../src/modules/checkout/guest/guest-checkout.config';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, pinConfig, setConfig, summarize, warmPool } from './helpers';

/** Chữ cái, không số và không `x`: tag ghép vào tên sản phẩm không được khớp mẫu quy cách gói (PACK_RE). */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWYZ';
const tag = (n = 8) => [...randomBytes(n)].map((b) => LETTERS[b % LETTERS.length]).join('');
const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Khách đổi đơn chuyển khoản chưa trả sang COD (OrderCodSwitchService) chạy chồng với tiền về (OrderStatusService.markPaid: hàm webhook Pancake
 * gọi khi đối soát VietQR) và cron tự huỷ quá hạn, trên Postgres THẬT: mỗi đơn rời PENDING_PAYMENT đúng một lần, không bao giờ vừa huỷ vừa COD.
 * Thêm các rào của lần đổi (đã trả, chuyển thiếu, quá trần, không phải kho Tubu, khoá theo dõi sai) và "Mua lại đơn này" của khách vãng lai.
 */
describe('COD switch vs payment webhook / expiry cron (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let codSwitch: OrderCodSwitchService;
  let guest: GuestCheckoutService;
  let admin: AdminService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const afterCodSwitch = jest.fn().mockResolvedValue(undefined);
  const restores: (() => Promise<void>)[] = [];
  const created = { orderIds: [] as string[], userIds: [] as string[], productIds: [] as string[] };
  const QTY = 2;
  const START_STOCK = 8;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, PENDING_PAYMENT_TTL_KEY, 24);
    restores.push(await pinConfig(prisma, GUEST_COD_MAX_KEY, 500_000));
    const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
    const affiliate = { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
    const analytics = new AnalyticsEventsService(prisma);
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics);
    codSwitch = new OrderCodSwitchService(prisma, orderStatus, notifications, analytics, { afterCodSwitch } as unknown as PancakeSyncHooks);
    const env = { get: (k: string) => ({ JWT_ACCESS_SECRET: 'it-secret-cod-switch' })[k] } as unknown as ConfigService<Env, true>;
    guest = new GuestCheckoutService(prisma, {} as never, {} as never, {} as never, new SystemConfigService(prisma), analytics, env, codSwitch);
    admin = new AdminService(prisma, {} as never, loyalty, affiliate, notifications, reversal, orderStatus, {} as never, {} as never, {} as never);
  });

  afterAll(async () => {
    for (const r of restores.reverse()) await r();
    if (prisma) {
      const { orderIds, userIds, productIds } = created;
      await prisma.$transaction([
        prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } }),
        // Cron huỷ đơn "Pancake báo chuyển thiếu" còn sót thì tạo khoản hoàn cho số đã nhận.
        prisma.orderCustomerRefund.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.gomdonAlert.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    notify.mockClear();
    afterCodSwitch.mockClear();
  });

  const newCron = () => new PendingPaymentExpiryCron(prisma, new SystemConfigService(prisma), orderStatus);

  // createdAt rất cũ: đơn của spec nằm đầu lô quét của cron (orderBy createdAt asc) và đã quá hạn thanh toán.
  const ancient = () => new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 86_400_000));

  async function variation(over: { stock?: number; productActive?: boolean } = {}) {
    const t = tag();
    const product = await prisma.product.create({
      data: {
        pancakeId: `itcod-p-${t}`,
        brand: 'IT',
        slug: `itcod-${t.toLowerCase()}`,
        name: `IT COD ${t}`,
        description: 'IT',
        basePrice: 100_000,
        isActive: over.productActive ?? true,
      },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itcod-v-${t}`,
        productId: product.id,
        sku: `ITCOD-${t}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock: over.stock ?? START_STOCK,
        reservedStock: QTY,
      },
    });
    return { ...v, slug: product.slug };
  }

  async function transferOrder(over: Partial<Prisma.OrderUncheckedCreateInput> = {}, userId?: string) {
    const uid = userId ?? (await createUser(prisma, { role: 'CUSTOMER' })).id;
    if (!userId) created.userIds.push(uid);
    const v = await variation();
    const total = over.total ?? 200_000;
    const order = await createOrder(prisma, {
      userId: uid,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total,
      subtotal: total,
      createdAt: ancient(),
      ...over,
      items: { create: [{ variationId: v.id, productName: 'IT COD', variationName: 'Mặc định', unitPrice: 100_000, quantity: QTY, total: 200_000 }] },
    });
    created.orderIds.push(order.id);
    return { order, userId: uid, variationId: v.id };
  }

  async function state(orderId: string, variationId: string) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: variationId } });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    const leftPending = history.filter((h) => h.fromStatus === 'PENDING_PAYMENT' && h.toStatus !== 'PENDING_PAYMENT');
    return { order, stock: v.stock, reserved: v.reservedStock, history, leftPending };
  }

  const refusalOf = (e: unknown) => (e instanceof ConflictException ? (e.getResponse() as { code?: string; reason?: string }) : null);

  async function expectRefused(promise: Promise<unknown>, reason: string) {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(refusalOf(err)).toMatchObject({ code: COD_SWITCH_REFUSED, reason });
  }

  /** Lần đọc đơn đầu tiên qua prisma.order.findFirst trả ảnh chụp cũ; `between` chạy & commit trước khi bên gọi ghi. */
  async function withStaleFirstRead<T>(between: () => Promise<unknown>, run: () => Promise<T>): Promise<T> {
    const original = prisma.order.findFirst.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      await between();
      return snap;
    }) as never);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  describe('đổi một chạm của chủ đơn', () => {
    it('đơn chuyển khoản chưa trả → COD + CONFIRMED, một dòng lịch sử, báo Pancake và khách đúng một lần', async () => {
      const { order, userId, variationId } = await transferOrder();
      const res = await codSwitch.switchForOwner(userId, order.code);

      expect(res).toEqual({ code: order.code, status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 200_000 });
      const s = await state(order.id, variationId);
      expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID' });
      expect(s.history).toHaveLength(1);
      expect(s.history[0]).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        actorType: 'CUSTOMER',
        actorId: userId,
        note: COD_SWITCH_HISTORY_NOTE,
      });
      // COD giao như đơn thường: hàng vẫn giữ cho đơn, không hoàn kho.
      expect([s.stock, s.reserved]).toEqual([START_STOCK, QTY]);
      expect(afterCodSwitch).toHaveBeenCalledTimes(1);
      expect(afterCodSwitch).toHaveBeenCalledWith(order.id);
      const forThis = notify.mock.calls.filter((c) => (c[2] as { order_code?: string })?.order_code === order.code);
      expect(forThis.map((c) => c[1])).toEqual(['ORDER_CONFIRMED']);
      await expectRefused(codSwitch.switchForOwner(userId, order.code), 'ALREADY_COD');
    });

    it('đơn của người khác: 404, đơn không đổi', async () => {
      const { order, variationId } = await transferOrder();
      const stranger = await createUser(prisma, { role: 'CUSTOMER' });
      created.userIds.push(stranger.id);
      await expect(codSwitch.switchForOwner(stranger.id, order.code)).rejects.toBeInstanceOf(NotFoundException);
      expect((await state(order.id, variationId)).order).toMatchObject({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
    });

    it('trần thu hộ 5.000.000đ: đúng trần đổi được, trên trần 409 OVER_MAX', async () => {
      const atCap = await transferOrder({ total: 5_000_000 });
      await expect(codSwitch.switchForOwner(atCap.userId, atCap.order.code)).resolves.toMatchObject({ paymentMethod: 'COD' });
      const over = await transferOrder({ total: 5_000_001 });
      await expectRefused(codSwitch.switchForOwner(over.userId, over.order.code), 'OVER_MAX');
      expect((await state(over.order.id, over.variationId)).order).toMatchObject({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
    });

    const hourAgo = () => new Date(Date.now() - 3_600_000);
    it.each<[string, Partial<Prisma.OrderUncheckedCreateInput>, string]>([
      ['đã trả', { paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: new Date() }, 'ALREADY_PAID'],
      ['đã huỷ', { status: 'CANCELLED' }, 'CLOSED'],
      ['đã là COD', { paymentMethod: 'COD', status: 'CONFIRMED' }, 'ALREADY_COD'],
      ['ZaloPay chưa trả', { paymentMethod: 'ZALOPAY' }, 'NOT_TRANSFER'],
      ['gian hàng đối tác tự giao', { fulfiller: 'MERCHANT' }, 'NOT_ELIGIBLE'],
      ['đơn đại lý', { type: 'DEALER' }, 'NOT_ELIGIBLE'],
      ['CTV đặt hộ', { placedForCustomer: true }, 'NOT_ELIGIBLE'],
      ['Pancake báo chuyển thiếu', { pancakePaidReported: 50_000 }, 'PAYMENT_IN_PROGRESS'],
      ['khoản chưa gắn đơn còn trong 48 giờ chờ', { paymentUnlinkedAt: hourAgo(), paymentUnlinkedFirstAt: hourAgo() }, 'PAYMENT_IN_PROGRESS'],
      ['đã bàn giao vận chuyển (thôi tự huỷ)', { autoCancelBlockedAt: new Date() }, 'PAYMENT_IN_PROGRESS'],
    ])('%s → 409 %s, đơn không đổi, không báo Pancake', async (_name, over, reason) => {
      const { order, userId, variationId } = await transferOrder(over);
      const before = await state(order.id, variationId);
      await expectRefused(codSwitch.switchForOwner(userId, order.code), reason);
      const after = await state(order.id, variationId);
      expect(after.order).toMatchObject({
        status: before.order.status,
        paymentMethod: before.order.paymentMethod,
        paymentStatus: before.order.paymentStatus,
      });
      expect(after.history).toHaveLength(before.history.length);
      expect(afterCodSwitch).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('đã có lệnh thanh toán (PaymentAttempt) → 409 PAYMENT_IN_PROGRESS', async () => {
      const { order, userId } = await transferOrder();
      await prisma.paymentAttempt.create({ data: { orderId: order.id, provider: 'ZALOPAY', appTransId: `itcod_${tag(12)}`, amount: order.total } });
      await expectRefused(codSwitch.switchForOwner(userId, order.code), 'PAYMENT_IN_PROGRESS');
    });

    it('khoản chưa gắn đơn đã quá 48 giờ chờ: đổi được (cùng mốc với cron tự huỷ)', async () => {
      const old = new Date(Date.now() - 49 * 3_600_000);
      const { order, userId } = await transferOrder({ paymentUnlinkedAt: old, paymentUnlinkedFirstAt: old });
      await expect(codSwitch.switchForOwner(userId, order.code)).resolves.toMatchObject({ paymentMethod: 'COD' });
    });

    it('10 lần bấm đồng thời trên một đơn → đúng một lần đổi, 9 lần 409 ALREADY_COD, một dòng lịch sử', async () => {
      const { order, userId, variationId } = await transferOrder();
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => codSwitch.switchForOwner(userId, order.code)));
      const s = summarize(results);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected.map((r) => refusalOf(r.reason)?.reason)).toEqual(Array(9).fill('ALREADY_COD'));
      expect((await state(order.id, variationId)).leftPending).toHaveLength(1);
      expect(afterCodSwitch).toHaveBeenCalledTimes(1);
    });
  });

  describe('chạy chồng với tiền về (markPaid của webhook VietQR/Pancake)', () => {
    it('markPaid đọc đơn, khách đổi COD chen giữa → câu lật của markPaid trượt, đọc lại rồi ghi tiền: đơn về lại chuyển khoản đã trả, rời PENDING_PAYMENT đúng 1 lần', async () => {
      const { order, userId, variationId } = await transferOrder();
      const res = await withStaleFirstRead(
        () => codSwitch.switchForOwner(userId, order.code),
        () => orderStatus.markPaid(order.id, { actorType: 'PANCAKE', note: 'Pancake ghi nhận chuyển khoản' }),
      );
      expect(res.outcome).toBe('PAID');
      const s = await state(order.id, variationId);
      // Tiền khách đã chuyển vẫn được ghi: đơn trở lại chuyển khoản đã trả, kho nhận lệnh "không thu COD", khách không trả hai lần.
      expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
      expect(s.leftPending).toHaveLength(1);
      expect(s.leftPending[0]!.note).toBe(COD_SWITCH_HISTORY_NOTE);
      expect(s.history.at(-1)!.note).toContain(COD_SWITCH_REVERTED_NOTE);
    });

    it('tiền về trước → đổi COD bị từ chối ALREADY_PAID, đơn giữ chuyển khoản', async () => {
      const { order, userId, variationId } = await transferOrder();
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      await expectRefused(codSwitch.switchForOwner(userId, order.code), 'ALREADY_PAID');
      const s = await state(order.id, variationId);
      expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
      expect(s.leftPending).toHaveLength(1);
      expect(afterCodSwitch).not.toHaveBeenCalled();
    });

    it('8 đơn, đổi COD và markPaid ĐỒNG THỜI từng đơn → mỗi đơn rời PENDING_PAYMENT đúng 1 lần, CONFIRMED, không lỗi lạ', async () => {
      const fixtures = await Promise.all(Array.from({ length: 8 }, () => transferOrder()));
      const results = await Promise.allSettled(
        fixtures.flatMap(({ order, userId }) => [codSwitch.switchForOwner(userId, order.code), orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })]),
      );
      for (const [i, { order, variationId }] of fixtures.entries()) {
        const sw = results[2 * i]!;
        const paid = results[2 * i + 1]!;
        expect(paid).toMatchObject({ status: 'fulfilled', value: { outcome: 'PAID' } });
        const s = await state(order.id, variationId);
        expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
        expect(s.leftPending).toHaveLength(1);
        // Đổi trước hay tiền về trước thì đơn cũng kết thúc là chuyển khoản đã trả.
        expect(s.order.paymentMethod).toBe('BANK_TRANSFER');
        if (sw.status === 'fulfilled') expect(s.leftPending[0]!.note).toBe(COD_SWITCH_HISTORY_NOTE);
        else expect(refusalOf(sw.reason)?.reason).toBe('ALREADY_PAID');
      }
    });
  });

  describe('tiền chuyển khoản về sau khi đã đổi COD', () => {
    async function switched(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
      const f = await transferOrder(over);
      await codSwitch.switchForOwner(f.userId, f.order.code);
      return f;
    }

    it('trước khi giao: về lại chuyển khoản đã trả; Tubu huỷ đơn sau đó thì hoàn Ví đủ tiền (không mất tiền khách)', async () => {
      const { order, userId, variationId } = await switched();
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      expect((await state(order.id, variationId)).order).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', status: 'CONFIRMED' });
      await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', pancakeGate: false });
      const after = (await state(order.id, variationId)).order;
      expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
      const credited = await prisma.walletTransaction.aggregate({ where: { userId, refId: order.id }, _sum: { delta: true } });
      expect(credited._sum.delta).toBe(200_000);
    });

    it('hàng đã rời kho, hay đơn COD thường: markPaid không lật (NOT_PAYABLE), đơn giữ COD chưa trả', async () => {
      const handed = await switched();
      await prisma.order.update({ where: { id: handed.order.id }, data: { shippedAt: new Date() } });
      expect((await orderStatus.markPaid(handed.order.id, { actorType: 'PANCAKE' })).outcome).toBe('NOT_PAYABLE');
      expect((await state(handed.order.id, handed.variationId)).order).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID' });
      const plain = await transferOrder({ paymentMethod: 'COD', status: 'CONFIRMED' });
      expect((await orderStatus.markPaid(plain.order.id, { actorType: 'PANCAKE' })).outcome).toBe('NOT_PAYABLE');
      expect((await state(plain.order.id, plain.variationId)).order).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    });

    it('đơn thu gom đã có vận đơn Gomdon (thu hộ bằng tổng đơn): lật xong mở báo động sửa thu hộ về 0đ', async () => {
      const { order } = await switched({ hasRecyclingPickup: true });
      await prisma.order.update({ where: { id: order.id }, data: { gomdonOrderId: `GDIT${order.code}` } });
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      const alerts = await prisma.gomdonAlert.findMany({ where: { orderId: order.id } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.message).toContain('Sửa tiền thu hộ về 0đ');
    });

    it('đơn đã lên kho Pancake (ghi chú THU COD) hay đã có mã vận đơn: lật xong vào "Cần xử lý Pancake" để kho kiểm thu hộ của vận đơn', async () => {
      const onPancake = await switched();
      await prisma.order.update({ where: { id: onPancake.order.id }, data: { pancakeOrderId: `PCIT${onPancake.order.code}` } });
      expect((await orderStatus.markPaid(onPancake.order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      const a = await prisma.order.findUniqueOrThrow({ where: { id: onPancake.order.id } });
      expect(a).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
      expect(a.pancakeAttention).toContain(ATTENTION_COD_SWITCH_REVERTED_CHECK_WAYBILL);
      expect(a.pancakeAttention).toContain(`đơn Pancake #PCIT${onPancake.order.code}`);
      expect(a.pancakeAttentionAt).not.toBeNull();

      const waybill = await switched();
      await prisma.order.update({ where: { id: waybill.order.id }, data: { shippingCode: `GHNIT${waybill.order.code}` } });
      expect((await orderStatus.markPaid(waybill.order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: waybill.order.id } })).pancakeAttention).toContain(`vận đơn GHNIT${waybill.order.code}`);
    });

    it('đơn đổi COD chưa lên Pancake, chưa có vận đơn: lật xong không thêm nhắc kiểm vận đơn', async () => {
      const { order } = await switched();
      expect((await orderStatus.markPaid(order.id, { actorType: 'PANCAKE' })).outcome).toBe('PAID');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention ?? '').not.toContain(ATTENTION_COD_SWITCH_REVERTED_CHECK_WAYBILL);
    });

    it('đơn thu gom đang chờ tiền ở Gomdon: đổi COD đưa về "chưa đặt bưu tá" để cron dò lại nếu lần xếp việc lỗi', async () => {
      const { order } = await switched({ hasRecyclingPickup: true, gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).gomdonStatus).toBeNull();
    });

    it('Pancake ghi chuyển thiếu sau khi đổi, rồi đơn huỷ: số đã nhận thành khoản hoàn', async () => {
      const { order } = await switched();
      await prisma.order.update({ where: { id: order.id }, data: { pancakePaidReported: 100_000, status: 'CANCELLED' } });
      const logger = { warn: jest.fn(), log: jest.fn() };
      expect(await refundReportedUnderpayment({ prisma, logger }, order.id)).toBe(100_000);
      const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([['LATE_PAYMENT', 100_000]]);
    });

    it('Kế toán xác nhận đã nhận tiền cho đơn đã đổi: về lại chuyển khoản đã trả; đơn đã huỷ thì ghi tiền về muộn; đơn COD thường: 400', async () => {
      const live = await switched();
      await admin.confirmOrderPayment('admin-it', live.order.code, { bankRef: `FT${live.order.code}` });
      expect((await state(live.order.id, live.variationId)).order).toMatchObject({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });

      const closed = await switched();
      await prisma.order.update({ where: { id: closed.order.id }, data: { status: 'CANCELLED' } });
      await admin.confirmOrderPayment('admin-it', closed.order.code, { bankRef: `FT${closed.order.code}`, amount: 200_000 });
      const refunds = await prisma.orderCustomerRefund.findMany({ where: { orderId: closed.order.id } });
      expect(refunds.map((r) => [r.kind, r.amount])).toEqual([['LATE_PAYMENT', 200_000]]);

      const plain = await transferOrder({ paymentMethod: 'COD', status: 'CONFIRMED' });
      await expect(admin.confirmOrderPayment('admin-it', plain.order.code, {})).rejects.toThrow('không phải chuyển khoản');
    });
  });

  describe('chạy chồng với cron tự huỷ quá hạn', () => {
    it('cron đọc đơn quá hạn, khách đổi COD chen giữa → cron trượt: đơn COD còn sống, không huỷ, không hoàn kho', async () => {
      // Dọn đơn quá hạn còn sót (của ca trước, của spec khác) để lần đọc đầu của cron là đơn của ca này.
      await newCron().expireStale();
      const { order, userId, variationId } = await transferOrder();
      let switched: unknown;
      await withStaleFirstRead(
        async () => {
          switched = await codSwitch.switchForOwner(userId, order.code);
        },
        () => newCron().expireStale(),
      );
      expect(switched).toMatchObject({ paymentMethod: 'COD' });
      const s = await state(order.id, variationId);
      expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD' });
      expect(s.history.filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(0);
      expect(s.leftPending).toHaveLength(1);
      expect([s.stock, s.reserved]).toEqual([START_STOCK, QTY]);
    });

    it('cron huỷ trước → đổi COD bị từ chối CLOSED', async () => {
      const { order, userId, variationId } = await transferOrder();
      await newCron().expireStale();
      await expectRefused(codSwitch.switchForOwner(userId, order.code), 'CLOSED');
      const s = await state(order.id, variationId);
      expect(s.order).toMatchObject({ status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER' });
      expect(s.leftPending).toHaveLength(1);
      expect(afterCodSwitch).not.toHaveBeenCalled();
    });

    it('8 đơn quá hạn, cron và đổi COD ĐỒNG THỜI → mỗi đơn hoặc COD còn sống, hoặc huỷ hoàn kho 1 lần; không đơn nào cả hai', async () => {
      const fixtures = await Promise.all(Array.from({ length: 8 }, () => transferOrder()));
      const results = await Promise.allSettled([
        newCron().expireStale(),
        ...fixtures.map(({ order, userId }) => codSwitch.switchForOwner(userId, order.code)),
      ]);
      expect(results[0]!.status).toBe('fulfilled');
      for (const [i, { order, variationId }] of fixtures.entries()) {
        const sw = results[i + 1]!;
        const s = await state(order.id, variationId);
        expect(s.leftPending).toHaveLength(1);
        if (s.order.status === 'CANCELLED') {
          expect(sw.status).toBe('rejected');
          expect(['CLOSED', 'NOT_PENDING']).toContain(refusalOf((sw as PromiseRejectedResult).reason)?.reason);
          expect(s.order.paymentMethod).toBe('BANK_TRANSFER');
          expect([s.stock, s.reserved]).toEqual([START_STOCK + QTY, 0]);
        } else {
          expect(sw.status).toBe('fulfilled');
          expect(s.order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD' });
          expect([s.stock, s.reserved]).toEqual([START_STOCK, QTY]);
        }
      }
    });
  });

  describe('khách vãng lai (khoá theo dõi)', () => {
    async function guestOrder(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
      const user = await createUser(prisma, { role: 'CUSTOMER', zaloId: `guest_${tag(16)}` });
      created.userIds.push(user.id);
      const key = randomBytes(32).toString('base64url');
      const res = await transferOrder({ guestTokenHash: sha256Hex(key), guestPhone: '0912345678', createdAt: new Date(), ...over }, user.id);
      return { ...res, key };
    }

    it('khoá sai hay thiếu: 404 như không có đơn, đơn không đổi', async () => {
      const { order, variationId } = await guestOrder();
      await expect(guest.switchToCod(order.code, randomBytes(32).toString('base64url'))).rejects.toBeInstanceOf(NotFoundException);
      await expect(guest.switchToCod(order.code, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect((await state(order.id, variationId)).order).toMatchObject({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
      expect(afterCodSwitch).not.toHaveBeenCalled();
    });

    it('khoá đúng: đổi được, bản theo dõi thôi mời đổi', async () => {
      const { order, key, variationId } = await guestOrder();
      expect((await guest.track(order.code, key)).codSwitchable).toBe(true);
      await expect(guest.switchToCod(order.code, key)).resolves.toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD' });
      const s = await state(order.id, variationId);
      expect(s.history[0]).toMatchObject({ actorType: 'CUSTOMER', actorId: null, note: COD_SWITCH_HISTORY_NOTE });
      expect((await guest.track(order.code, key)).codSwitchable).toBe(false);
    });

    it('trần COD của khách vãng lai (500.000đ) áp cho lần đổi như lúc thanh toán', async () => {
      const { order, key } = await guestOrder({ total: 600_000 });
      expect((await guest.track(order.code, key)).codSwitchable).toBe(false);
      await expectRefused(guest.switchToCod(order.code, key), 'OVER_MAX');
    });
  });

  describe('"Mua lại đơn này" của khách vãng lai', () => {
    async function closedGuestOrder(status: 'DELIVERED' | 'CANCELLED' | 'CONFIRMED' = 'DELIVERED') {
      const user = await createUser(prisma, { role: 'CUSTOMER', zaloId: `guest_${tag(16)}` });
      created.userIds.push(user.id);
      const key = randomBytes(32).toString('base64url');
      const ok = await variation({ stock: 2 });
      const gift = await variation();
      const soldOut = await variation({ stock: 0 });
      const gone = await variation({ productActive: false });
      const line = (v: { id: string }, name: string, quantity: number, isGift = false) => ({
        variationId: v.id,
        productName: name,
        variationName: 'Mặc định',
        unitPrice: isGift ? 0 : 100_000,
        quantity,
        total: isGift ? 0 : 100_000 * quantity,
        isGift,
      });
      const order = await createOrder(prisma, {
        userId: user.id,
        status,
        paymentMethod: 'COD',
        guestTokenHash: sha256Hex(key),
        guestPhone: '0912345678',
        ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        items: { create: [line(ok, 'Còn hàng', 3), line(gift, 'Quà 0đ', 1, true), line(soldOut, 'Hết hàng', 1), line(gone, 'Ngừng bán', 1)] },
      });
      created.orderIds.push(order.id);
      return { order, key, ok };
    }

    it('đơn đã giao: bỏ quà 0đ, món hết hàng và ngừng bán; kẹp số lượng theo tồn', async () => {
      const { order, key, ok } = await closedGuestOrder();
      const res = await guest.reorderLines(order.code, key);
      expect(res.lines).toEqual([{ variationId: ok.id, slug: ok.slug, quantity: 2, maxQty: 2, productName: 'Còn hàng', variationName: 'Mặc định' }]);
      expect(res.skipped).toHaveLength(2);
      expect(res.skipped).toEqual(
        expect.arrayContaining([
          { productName: 'Hết hàng', variationName: 'Mặc định', reason: 'OUT_OF_STOCK' },
          { productName: 'Ngừng bán', variationName: 'Mặc định', reason: 'INACTIVE' },
        ]),
      );
    });

    it('đơn đã huỷ mua lại được; đơn còn đang xử lý: 409; khoá sai: 404', async () => {
      const cancelled = await closedGuestOrder('CANCELLED');
      expect((await guest.reorderLines(cancelled.order.code, cancelled.key)).lines).toHaveLength(1);
      const open = await closedGuestOrder('CONFIRMED');
      await expect(guest.reorderLines(open.order.code, open.key)).rejects.toBeInstanceOf(ConflictException);
      await expect(guest.reorderLines(cancelled.order.code, randomBytes(32).toString('base64url'))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
