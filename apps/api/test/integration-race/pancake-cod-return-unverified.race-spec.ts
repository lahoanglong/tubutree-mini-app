import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { ATTENTION_COD_RETURN_UNVERIFIED } from '../../src/modules/integrations/pancake/pancake-attention';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * D12-01: Pancake "Đã hoàn" trên đơn COD đang DELIVERED không chứng minh hãng đã thu tiền (kho bấm "Đã nhận" hàng loạt/nhầm).
 * Trên Postgres THẬT: tiền KHÔNG tự vào Ví, đơn sang RETURNED, một khoản RETURN UNVERIFIED chờ Kế toán và một dòng "Cần xử lý
 * Pancake" ghi cùng tx; webhook gửi lại / hai webhook song song không đẻ khoản thứ hai; Kế toán xác nhận → PENDING hoặc bỏ qua.
 * Đơn chuyển khoản đã PAID vẫn tự hoàn đủ vào Ví.
 */
describe('Pancake "Đã hoàn" trên đơn COD đã giao (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let refunds: CustomerRefundsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        CustomerRefundsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    refunds = moduleRef.get(CustomerRefundsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const fromPancake = (id: string) =>
    orderStatus.setStatus(id, 'RETURNED', { actorType: 'PANCAKE', returnedToSender: true, withholdCodRefund: true });

  async function deliveredCod(total = 300_000, extra: Record<string, unknown> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total, subtotal: total, ...extra });
    return { user, order };
  }

  const walletOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;

  it('COD UNPAID DELIVERED 300.000đ nhận "Đã hoàn": RETURNED, Ví không đổi, ĐÚNG MỘT khoản chờ đối soát + hàng cần xử lý', async () => {
    const { user, order } = await deliveredCod();

    await fromPancake(order.id);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('UNPAID');
    expect(after.pancakeAttention).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(after.pancakeAttentionAt).not.toBeNull();
    expect(await walletOf(user.id)).toBe(0);
    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'RETURN', refKey: 'cod-return-unverified', status: 'UNVERIFIED', method: 'MANUAL_TRANSFER', amount: 300_000, userId: user.id });

    // Webhook gửi lại: đơn đã RETURNED → no-op, không khoản thứ hai.
    await fromPancake(order.id);
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('hai webhook "Đã hoàn" song song cho cùng đơn → một khoản, Ví vẫn 0', async () => {
    const { user, order } = await deliveredCod(450_000);

    const s = summarize(await Promise.allSettled([fromPancake(order.id), fromPancake(order.id)]));

    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(1);
    expect(await walletOf(user.id)).toBe(0);
  });

  it('Kế toán xác nhận hãng đã thu → PENDING, hàng cần xử lý được gỡ, lịch sử đơn có vết; xác nhận lần hai bị từ chối', async () => {
    const accountant = await createUser(prisma, { role: 'ADMIN' });
    const { order } = await deliveredCod();
    await fromPancake(order.id);
    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });

    await refunds.verifyOverpayment(accountant.id, row.id, { note: 'GHN xác nhận đã thu' });

    const after = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'PENDING', amount: 300_000 });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.pancakeAttention).toBeNull();
    expect(o.pancakeAttentionAt).toBeNull();
    const notes = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, actorId: accountant.id } });
    expect(notes.some((n) => n.note?.includes('COD'))).toBe(true);
    await expect(refunds.verifyOverpayment(accountant.id, row.id, {})).rejects.toThrow('không còn chờ đối soát');
  });

  it('Kế toán bỏ qua (hãng chưa thu) → DISMISSED có lý do, không có khoản PENDING, hàng cần xử lý được gỡ', async () => {
    const accountant = await createUser(prisma, { role: 'ADMIN' });
    const { user, order } = await deliveredCod();
    await fromPancake(order.id);
    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });

    await expect(refunds.dismissOverpayment(accountant.id, row.id, { reason: 'x' })).rejects.toThrow();
    await refunds.dismissOverpayment(accountant.id, row.id, { reason: 'GHN báo chưa thu, hàng về nguyên tem' });

    const after = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'DISMISSED', adminNote: 'GHN báo chưa thu, hàng về nguyên tem', completedBy: accountant.id });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention).toBeNull();
    expect(await walletOf(user.id)).toBe(0);
  });

  it('đơn đã có lý do cần xử lý khác (lệch tổng) → giữ lý do đó, Kế toán quyết xong chỉ gỡ lý do COD', async () => {
    const accountant = await createUser(prisma, { role: 'ADMIN' });
    const mismatch = 'Tổng tiền Pancake lệch với Tubu';
    const { order } = await deliveredCod(300_000, { pancakeAttention: mismatch, pancakeAttentionAt: new Date() });

    await fromPancake(order.id);
    const flagged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(flagged.pancakeAttention).toBe(`${mismatch} | ${ATTENTION_COD_RETURN_UNVERIFIED}`);

    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });
    await refunds.dismissOverpayment(accountant.id, row.id, { reason: 'Hãng chưa thu tiền' });
    const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(done.pancakeAttention).toBe(mismatch);
    expect(done.pancakeAttentionAt).not.toBeNull();
  });

  it('đơn chuyển khoản đã PAID 300.000đ nhận "Đã hoàn" (không cờ giữ lại) → tự hoàn đủ vào Ví, REFUNDED, không khoản chờ đối soát', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 300_000, subtotal: 300_000 });

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE', returnedToSender: true });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(await walletOf(user.id)).toBe(300_000);
    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows.every((r) => r.status !== 'UNVERIFIED')).toBe(true);
    expect(after.pancakeAttention).toBeNull();
  });
});
