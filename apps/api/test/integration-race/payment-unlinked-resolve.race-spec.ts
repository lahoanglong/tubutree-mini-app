import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { OpsInboxService } from '../../src/modules/ops/ops-inbox.service';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Khoản "Pancake báo đã thanh toán, đơn chưa gắn" nằm ở cột paymentUnlinkedAt (không phải ô chữ pancakeAttention): KHO xoá ô chữ không được
 * làm mất khoản tiền chờ đối chiếu, và hai ADMIN đóng cùng lúc thì đúng một bên thắng (real Postgres).
 */
describe('Cờ paymentUnlinkedAt: webhook, KHO "Đã xử lý" và ADMIN "Đã đối chiếu" đua nhau (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let proc: PancakeProcessor;
  let inbox: OpsInboxService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn() } as unknown as LoyaltyService;
    const affiliate = { lockCommissionsForOrder: jest.fn(), grantReferralReward: jest.fn(), reverseCommissionsForOrder: jest.fn() } as unknown as AffiliateService;
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
    const reversal = new OrderReversalService(
      { restore: jest.fn() } as unknown as FlashSaleService,
      { release: jest.fn() } as unknown as CouponsService,
    );
    const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, new AnalyticsEventsService(prisma));
    admin = new AdminService(prisma, {} as never, loyalty, affiliate, notifications, reversal, orderStatus, {} as never, {} as never, {} as never);
    proc = new PancakeProcessor(prisma, notifications, orderStatus, alerts as never);
    inbox = new OpsInboxService(prisma, { countOverdue: async () => 0, countStoresToSettle: async () => 0 } as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const hold = (order: unknown, id: string) =>
    (proc as unknown as { holdUnattachedPayment(o: unknown, d: Record<string, unknown>, r: number): Promise<void> }).holdUnattachedPayment(order, { id }, 100_000);

  const flagOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, select: { paymentUnlinkedAt: true } })).paymentUnlinkedAt;

  it('KHO resolvePancakeAttention song song với webhook lặp cùng cặp → cờ paymentUnlinkedAt không đổi (cùng mốc), ô chữ thì được gỡ (10 vòng)', async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser(prisma);
      const kho = await createUser(prisma, { role: 'STAFF' });
      const order = await createOrder(prisma, {
        userId: user.id,
        status: 'CANCELLED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'UNPAID',
        total: 100_000,
        pancakeOrderId: null,
        pancakeAttention: 'Pancake báo ĐANG HOÀN',
        pancakeAttentionAt: new Date(),
      });
      await hold(order, `PK-${i}`);
      const before = await flagOf(order.id);
      expect(before).not.toBeNull();
      await Promise.all([hold(order, `PK-${i}`), admin.resolvePancakeAttention(kho.id, order.id, 'kho đã xử lý')]);
      expect(await flagOf(order.id)).toEqual(before);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { pancakeAttentionAt: true } })).pancakeAttentionAt).toBeNull();
    }
  });

  it('webhook is_paid song song với ADMIN "Đã nhận tiền" trên đơn mở → cuối cùng PAID và hộp việc paymentUnlinked không tăng (20 vòng)', async () => {
    const admin1 = await createUser(prisma, { role: 'ADMIN' });
    const countOpen = async () => (await inbox.counts({ role: 'ADMIN' })).items.find((i) => i.key === 'paymentUnlinked')?.count ?? 0;
    const before = await countOpen();
    for (let i = 0; i < 20; i++) {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await Promise.all([hold(order, `PK-C${i}`), admin.confirmOrderPayment(admin1.id, order.id, {})]);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true, paymentUnlinkedAt: true } });
      expect(after.paymentStatus).toBe('PAID');
      expect(after.paymentUnlinkedAt).toBeNull();
    }
    expect(await countOpen()).toBe(before);
  });

  it('hai ADMIN resolve cùng lúc → đúng một bên OK, bên kia 400; cờ gỡ, đúng một dòng lịch sử "Đã đối chiếu" (10 vòng)', async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser(prisma);
      const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await hold(order, `PK-R${i}`);
      const seenAt = (await flagOf(order.id))!.toISOString();
      const res = await Promise.allSettled([admin.resolvePaymentUnlinked(a1.id, order.id, 'đã ghi tiền về muộn', seenAt), admin.resolvePaymentUnlinked(a2.id, order.id, 'đã hoàn khách', seenAt)]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(BadRequestException);
      expect((rejected[0]!.reason as BadRequestException).message).toContain('không còn khoản Pancake báo đã thanh toán chờ đối chiếu');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedAt: true } })).paymentUnlinkedAt).toBeNull();
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'ADMIN', note: { startsWith: 'Đã đối chiếu khoản Pancake báo đã thanh toán' } } })).toBe(1);
    }
  });

  it('tuần tự: webhook đặt cờ, ADMIN ghi tiền về muộn (CREATED) KHÔNG gỡ cờ, webhook lặp cùng cặp không đổi mốc (dấu lịch sử chặn); #B tới sau vẫn giữ cờ', async () => {
    const user = await createUser(prisma);
    const adm = await createUser(prisma, { role: 'ADMIN' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
    await hold(order, 'PK-L1');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedAt: true } })).paymentUnlinkedAt).not.toBeNull();
    const res = await admin.confirmOrderPayment(adm.id, order.id, { bankRef: `FT${Date.now()}` });
    expect(res).toMatchObject({ latePayment: true });
    const kept = await flagOf(order.id);
    expect(kept).not.toBeNull();
    await hold(order, 'PK-L1');
    expect(await flagOf(order.id)).toEqual(kept);
    await hold(order, 'PK-L2');
    expect((await flagOf(order.id))!.getTime()).toBeGreaterThan(kept!.getTime());
  });

  it('đơn đã huỷ đã có dòng LATE_PAYMENT Pancake, khoản #B chưa gắn đặt cờ: ADMIN ghi tiền về muộn (EXISTS) KHÔNG gỡ cờ', async () => {
    const user = await createUser(prisma);
    const adm = await createUser(prisma, { role: 'ADMIN' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 200_000, pancakeOrderId: null });
    await prisma.orderCustomerRefund.create({
      data: { orderId: order.id, orderCode: order.code, kind: 'LATE_PAYMENT', refKey: 'PANCAKE:paid:200000', userId: user.id, amount: 200_000, method: 'MANUAL_TRANSFER', status: 'PENDING', reason: 'CANCELLED' },
    });
    await hold(order, 'PK-B');
    await admin.confirmOrderPayment(adm.id, order.id, { bankRef: `FT${Date.now()}` });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedAt: true } })).paymentUnlinkedAt).not.toBeNull();
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id, kind: 'LATE_PAYMENT' } })).toBe(1);
  });

  it('hai cặp Pancake khác nhau tới: cờ đẩy lên mốc mới; resolve với seenAt cũ → 409, cờ còn; resolve với mốc mới → đóng (10 vòng)', async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser(prisma);
      const adm = await createUser(prisma, { role: 'ADMIN' });
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await hold(order, `PK-A${i}`);
      const seenA = (await flagOf(order.id))!;
      await hold(order, `PK-B${i}`);
      const seenB = (await flagOf(order.id))!;
      expect(seenB.getTime()).toBeGreaterThan(seenA.getTime());
      const firstAt = async () => (await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedFirstAt: true } })).paymentUnlinkedFirstAt;
      expect(await firstAt()).toEqual(seenA);

      const err = await admin.resolvePaymentUnlinked(adm.id, order.id, 'đã đối chiếu A', seenA.toISOString()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('Có khoản Pancake mới báo đã thanh toán');
      expect(await flagOf(order.id)).toEqual(seenB);

      await expect(admin.resolvePaymentUnlinked(adm.id, order.id, 'đã đối chiếu A và B', seenB.toISOString())).resolves.toMatchObject({ ok: true });
      expect(await flagOf(order.id)).toBeNull();
      expect(await firstAt()).toBeNull();
    }
  });

  it('hai cặp khác nhau tới CÙNG LÚC (cùng mili giây): hai mốc vẫn khác nhau (tăng ngặt), mốc đầu tiên không đổi sau cặp thứ hai; hộp việc oldest = mốc đầu', async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await hold(order, `PK-A${i}`);
      const a = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedAt: true, paymentUnlinkedFirstAt: true } });
      expect(a.paymentUnlinkedFirstAt).toEqual(a.paymentUnlinkedAt);
      await Promise.all([hold(order, `PK-B${i}`), hold(order, `PK-C${i}`)]);
      const b = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentUnlinkedAt: true, paymentUnlinkedFirstAt: true } });
      expect(b.paymentUnlinkedFirstAt).toEqual(a.paymentUnlinkedFirstAt);
      expect(b.paymentUnlinkedAt!.getTime()).toBeGreaterThanOrEqual(a.paymentUnlinkedAt!.getTime() + 2);
    }
  });

  it('hộp việc: oldest của paymentUnlinked tính theo mốc đầu, không trẻ lại khi khoản #B tới', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
    await prisma.order.updateMany({ where: { paymentUnlinkedAt: { not: null }, id: { not: order.id } }, data: { paymentUnlinkedAt: null, paymentUnlinkedFirstAt: null } });
    await hold(order, 'PK-O1');
    const t0 = (await flagOf(order.id))!;
    await hold(order, 'PK-O2');
    const item = (await inbox.counts({ role: 'ADMIN' })).items.find((i) => i.key === 'paymentUnlinked');
    expect(item?.oldestAt).toBe(t0.toISOString());
  });

  it('resolve với seenA song song với khoản #B tới: hoặc resolve thắng rồi #B đặt lại cờ, hoặc #B đẩy mốc trước nên resolve 409 — không bao giờ mất cờ của #B (10 vòng)', async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser(prisma);
      const adm = await createUser(prisma, { role: 'ADMIN' });
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await hold(order, `PK-A${i}`);
      const seenA = (await flagOf(order.id))!;
      await Promise.allSettled([hold(order, `PK-B${i}`), admin.resolvePaymentUnlinked(adm.id, order.id, 'đã đối chiếu A', seenA.toISOString())]);
      expect(await flagOf(order.id)).not.toBeNull();
    }
  });
});
