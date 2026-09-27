import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * A6-06 (docs/audit-2026-09/06-web.md): duyệt hoàn tiền ("Duyệt hoàn tiền") trong admin không thực
 * sự hoàn tiền cho đơn COD, vì reverseFinancials CŨ chỉ hoàn khi paymentStatus='PAID' — mà KHÔNG có
 * đường code nào trong hệ thống từng lật COD sang PAID (OrderStatusService cố ý bỏ force-PAID khi
 * DELIVERED — P2-3; PancakeProcessor.onPaymentReconcile chỉ xử lý BANK_TRANSFER). Test này chạy trên
 * Postgres THẬT (không mock Prisma) để chứng minh: một đơn COD đã DELIVERED (tài xế đã thu tiền mặt)
 * rồi được admin duyệt trả hàng → Ví khách ĐƯỢC cộng đúng 1 lần bằng tổng đơn, và duyệt lại/duyệt
 * đồng thời không cộng ví lần 2.
 */
describe('COD delivered → admin duyệt hoàn tiền (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        AdminService,
        { provide: AffiliateService, useValue: {
          reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
          lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
          grantReferralReward: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        // Không liên quan tới tiền của lần duyệt trả hàng này — stub tối thiểu.
        { provide: RbacService, useValue: {} },
        { provide: GomdonOrderService, useValue: {} },
        { provide: GomdonClient, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = moduleRef.get(AdminService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Đơn COD đã DELIVERED (tài xế đã thu tiền mặt) + yêu cầu đổi/trả REQUESTED. */
  async function deliveredCodOrderWithReturnRequest(total = 350_000) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID', // COD LUÔN UNPAID kể cả khi đã giao — xem comment ở reverseFinancials
      total,
      subtotal: total,
    });
    const req = await prisma.returnRequest.create({
      data: { orderId: order.id, userId: user.id, reason: 'Hàng lỗi', status: 'REQUESTED' },
    });
    return { user, order, req };
  }

  it('duyệt hoàn tiền đơn COD đã DELIVERED → status RETURNED, paymentStatus REFUNDED, Ví cộng ĐÚNG tổng đơn 1 lần', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, order, req } = await deliveredCodOrderWithReturnRequest(350_000);

    await admin.reviewReturn(adminUser.id, req.id, true, 'Đồng ý đổi trả');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(wallet.walletBalance).toBe(350_000);

    // Duyệt lại (double-tap / retry) trên request ĐÃ APPROVED → từ chối, KHÔNG cộng ví lần 2.
    await expect(admin.reviewReturn(adminUser.id, req.id, true)).rejects.toThrow();
    const wallet2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    expect(wallet2.walletBalance).toBe(350_000);
  });

  it('COD CHƯA DELIVERED (huỷ từ CONFIRMED, tiền chưa từng thu) → Ví KHÔNG được cộng', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      total: 200_000,
      subtotal: 200_000,
    });
    const orderStatus = moduleRef.get(OrderStatusService);
    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'CUSTOMER' });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    expect(after.status).toBe('CANCELLED');
    expect(after.paymentStatus).toBe('UNPAID'); // không có gì để hoàn — tiền COD chưa từng thu
    expect(wallet.walletBalance).toBe(0);
  });

  it('2 admin bấm "Duyệt hoàn tiền" ĐỒNG THỜI cho CÙNG 1 request → chỉ 1 bên thắng, Ví cộng đúng 1 lần', async () => {
    const admin1 = await createUser(prisma, { role: 'ADMIN' });
    const admin2 = await createUser(prisma, { role: 'ADMIN' });
    const { user, order, req } = await deliveredCodOrderWithReturnRequest(420_000);

    const results = await Promise.allSettled([
      admin.reviewReturn(admin1.id, req.id, true, 'admin1'),
      admin.reviewReturn(admin2.id, req.id, true, 'admin2'),
    ]);
    const s = summarize(results);
    // eslint-disable-next-line no-console
    console.log('[concurrent-approve] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);
    expect(s.fulfilled.length).toBe(1);
    expect(s.rejected.length).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(wallet.walletBalance).toBe(420_000); // KHÔNG bị cộng 2 lần
  });
});
