import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { PENDING_PAYMENT_TTL_KEY, PendingPaymentExpiryCron } from '../../src/modules/orders/pending-payment-expiry.cron';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PancakeHandedOverError } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * R4-SYNC-5 + R4-SYNC-3c trên Postgres THẬT: đơn chuyển khoản chưa thanh toán mà kho đã gửi hàng (Pancake báo "Đã gửi hàng",
 * hoặc đơn đã mang mã vận đơn hãng). Trước đây cron hết hạn thử huỷ lại mỗi 10 phút, mỗi lượt ghi ERROR và gắn lại "Cần xử lý
 * Pancake" dù admin đã bấm "Đã xử lý", mà không báo admin in-app lần nào. Giờ: lượt đầu ghi mốc thôi tự huỷ, nhắc + báo admin
 * một lần; các lượt sau bỏ qua đơn. Stub: Pancake (đã gửi hàng), thông báo, điểm, hoa hồng.
 */
describe('Cron hết hạn thanh toán gặp đơn đã bàn giao vận chuyển (real Postgres)', () => {
  let prisma: PrismaService;
  let cron: PendingPaymentExpiryCron;
  const notify = jest.fn().mockResolvedValue(undefined);
  const handedOver = new Set<string>();
  const pancakeHooks = {
    precheckCancel: jest.fn(async (order: { id: string }) => {
      if (handedOver.has(order.id)) throw new PancakeHandedOverError(2);
      return { kind: 'NONE' };
    }),
    afterLocalCancel: jest.fn().mockResolvedValue(undefined),
    afterPaid: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, PENDING_PAYMENT_TTL_KEY, 24);
    await createUser(prisma, { role: 'ADMIN' });
    const orderStatus = new OrderStatusService(
      prisma,
      { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
        grantReferralReward: jest.fn().mockResolvedValue(undefined),
        reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      } as unknown as AffiliateService,
      { notify } as unknown as NotificationsService,
      new OrderReversalService(
        { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
        { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
      ),
      undefined,
      new AnalyticsEventsService(prisma),
      pancakeHooks as never,
    );
    cron = new PendingPaymentExpiryCron(prisma, new SystemConfigService(prisma), orderStatus);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // createdAt rất cũ: đơn của spec luôn nằm đầu lô quét (orderBy createdAt asc), không phụ thuộc đơn của spec khác.
  const ancient = () => new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 86_400_000));
  const alertsFor = (code: string) =>
    notify.mock.calls.filter(([, template, data]) => template === 'OPS_PANCAKE_ALERT' && (data as { order_code?: string }).order_code === code).length;
  /** Đúng câu của nút "Đã xử lý" (AdminService.resolvePancakeAttention). */
  const resolveAttention = (id: string) =>
    prisma.order.updateMany({ where: { id, pancakeAttentionAt: { not: null } }, data: { pancakeAttention: null, pancakeAttentionAt: null } });

  it.each([
    ['Pancake báo "Đã gửi hàng" khi hỏi trước lúc huỷ', { pancakeShipped: true }],
    ['đơn đã mang mã vận đơn hãng', { shippingCode: `GHN${randCode(6)}`, shippingPartner: 'GHN' }],
  ])('%s → lượt đầu: thôi tự huỷ, nhắc + báo admin một lần; admin "Đã xử lý" rồi 3 lượt sau: không nhắc lại, không báo lại', async (_label, setup) => {
    const user = await createUser(prisma);
    const { pancakeShipped, ...extra } = setup as { pancakeShipped?: boolean; shippingCode?: string; shippingPartner?: string };
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      pancakeOrderId: `pk-${randCode(8)}`,
      createdAt: ancient(),
      ...extra,
    });
    if (pancakeShipped) handedOver.add(order.id);

    await cron.expireStale(new Date());
    const first = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(first.status).toBe('PENDING_PAYMENT');
    expect(first.autoCancelBlockedAt).not.toBeNull();
    expect(first.pancakeAttention).toContain('"Đã nhận tiền"');
    const alerted = alertsFor(order.code);
    expect(alerted).toBeGreaterThan(0);

    await resolveAttention(order.id);
    for (let i = 0; i < 3; i++) await cron.expireStale(new Date());

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'PENDING_PAYMENT', pancakeAttention: null, pancakeAttentionAt: null });
    expect(after.autoCancelBlockedAt).toEqual(first.autoCancelBlockedAt);
    expect(alertsFor(order.code)).toBe(alerted);
    expect(pancakeHooks.precheckCancel.mock.calls.filter(([o]) => (o as { id: string }).id === order.id).length).toBeLessThanOrEqual(1);
  });

  it('đơn quá hạn chưa bàn giao vẫn tự huỷ như cũ', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      createdAt: ancient(),
    });
    await cron.expireStale(new Date());
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', autoCancelBlockedAt: null });
  });
});
