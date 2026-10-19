import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { ATTENTION_CANCEL_AFTER_HANDOVER, ATTENTION_COD_RETURN_UNVERIFIED } from '../../src/modules/integrations/pancake/pancake-attention';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * D12-02 trên Postgres THẬT: lỗi ở đảo điểm sau commit CANCELLED/RETURNED không làm khách mất Điểm Xanh thường đã dùng, lần gọi
 * lại làm nốt phần còn thiếu đúng một lần, và lý do COD chờ đối soát không bị việc đóng cảnh báo cũ xoá.
 */
describe('Việc sau commit của đơn huỷ/trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let loyalty: LoyaltyService;
  let hooks: { afterLocalCancel: jest.Mock; precheckCancel: jest.Mock };
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    hooks = {
      afterLocalCancel: jest.fn().mockResolvedValue(undefined),
      precheckCancel: jest.fn().mockResolvedValue({ kind: 'NONE' }),
    };
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    // pancakeHooks là @Optional() tiêm theo class nên dựng tay: chỉ cần biết afterLocalCancel được gọi mấy lần.
    (orderStatus as unknown as { pancakeHooks: unknown }).pancakeHooks = hooks;
    loyalty = moduleRef.get(LoyaltyService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    notify.mockClear();
    hooks.afterLocalCancel.mockClear();
    jest.restoreAllMocks();
  });

  const dbDown = () => new Error('P2024: hết kết nối trong pool');
  const balanceOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } })).pointsBalance;
  const ledger = (orderId: string, reasonPrefix: string) =>
    prisma.pointsTransaction.findMany({ where: { refId: orderId, reason: { startsWith: reasonPrefix } } });

  async function walletOrderUsingStandardPoints(status: 'CONFIRMED' | 'DELIVERED', extra: Record<string, unknown> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status,
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 120_000,
      pointsUsed: 20_000,
      pointsUsedConverted: 0,
      ...extra,
    });
    return { user, order };
  }

  it('huỷ đơn WALLET dùng 20.000 điểm thường, reverseOrderPoints ném lỗi: điểm đã hoàn trong tx, tin khách + lệnh huỷ Pancake đã đi, thử lại không hoàn lần hai', async () => {
    const { user, order } = await walletOrderUsingStandardPoints('CONFIRMED');
    jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(dbDown());

    await expect(orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' })).rejects.toThrow('P2024');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');
    expect(await balanceOf(user.id)).toBe(20_000);
    const refunds = await ledger(order.id, 'ORDER_REFUND_POINTS:');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ delta: 20_000, lot: 'STANDARD' });
    expect(refunds[0]!.expiresAt).not.toBeNull();
    expect(hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![2].refund_note).toContain('20.000');

    await expect(orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' })).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(await balanceOf(user.id)).toBe(20_000);
    expect(await ledger(order.id, 'ORDER_REFUND_POINTS:')).toHaveLength(1);
    expect(hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('trả đơn đã giao (tích 50, dùng 10 điểm thường), reverseOrderPoints ném lỗi một lần: lần thử lại thu hồi điểm tích đúng một lần, số dư cuối = 50 + 10 - 50', async () => {
    const { user, order } = await walletOrderUsingStandardPoints('DELIVERED', { pointsUsed: 10, pointsEarned: 50 });
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: 50, reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, expiresAt: new Date(Date.now() + 86_400_000 * 300) },
    });
    await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: 50 } });
    jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(dbDown());

    await expect(orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' })).rejects.toThrow('P2024');
    expect(await balanceOf(user.id)).toBe(60);
    expect(await ledger(order.id, 'ORDER_REVERSED:')).toHaveLength(0);

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });
    expect(await balanceOf(user.id)).toBe(10);
    expect(await ledger(order.id, 'ORDER_REVERSED:')).toHaveLength(1);
    expect(await ledger(order.id, 'ORDER_REFUND_POINTS:')).toHaveLength(1);

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });
    expect(await balanceOf(user.id)).toBe(10);
  });

  it('hai lần huỷ song song cùng đơn (admin + webhook): điểm hoàn đúng một lần, tin khách một lần', async () => {
    const { user, order } = await walletOrderUsingStandardPoints('CONFIRMED');

    const s = summarize(
      await Promise.allSettled([
        orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
        orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
      ]),
    );

    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await balanceOf(user.id)).toBe(20_000);
    expect(await ledger(order.id, 'ORDER_REFUND_POINTS:')).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('P3: đơn COD đang có lý do "Pancake báo HUỶ…" rồi nhận "Đã hoàn": lý do COD chờ đối soát còn nguyên, lý do cũ được gỡ', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      total: 300_000,
      subtotal: 300_000,
      pancakeAttention: `${ATTENTION_CANCEL_AFTER_HANDOVER} (mã 6) — kiểm tra`,
      pancakeAttentionAt: new Date(),
    });

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE', returnedToSender: true, withholdCodRefund: true });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('RETURNED');
    expect(after.pancakeAttention).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(after.pancakeAttentionAt).not.toBeNull();
  });
});
