import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * C-001 / A5N-01 (docs/2026-10-review): đơn CTV "lên đơn hộ" (placedForCustomer) ghi userId = CTV, nên
 * mọi đường hoàn tiền cũ (khách tự huỷ, admin huỷ, admin duyệt trả hàng, COD đã giao rồi trả) cộng
 * order.total vào VÍ CTV — khách thật đã trả tiền mất trắng. Chạy trên Postgres THẬT: tiền phải về ví
 * khách cuối (khớp SĐT) hoặc thành yêu cầu hoàn thủ công cho admin, ví CTV không bao giờ đổi.
 */
describe('Hoàn tiền đơn CTV lên hộ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;
  let orders: OrdersService;
  let orderStatus: OrderStatusService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        AdminService,
        CustomerRefundsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: CartService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        { provide: RbacService, useValue: {} },
        { provide: GomdonOrderService, useValue: {} },
        { provide: GomdonClient, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = moduleRef.get(AdminService);
    orders = moduleRef.get(OrdersService);
    orderStatus = moduleRef.get(OrderStatusService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function walletOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
    return u.walletBalance;
  }

  /**
   * Đơn CTV lên hộ đúng hình dạng affiliate.placeOrderForCustomer tạo: userId = referrerUserId = CTV,
   * placedForCustomer, endCustomerKey = SĐT khách dạng nội địa, kèm 1 hoa hồng PENDING cho CTV.
   */
  async function assistedOrder(opts: {
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'DELIVERED';
    paymentMethod: 'COD' | 'BANK_TRANSFER';
    paymentStatus: 'UNPAID' | 'PAID';
    total?: number;
    customerPhone?: string;
    ctvPhone?: string;
  }) {
    const total = opts.total ?? 200_000;
    const ctv = await createUser(prisma, { role: 'AFFILIATE', walletBalance: 0, phone: opts.ctvPhone ?? randomPhone() });
    const customerPhone = opts.customerPhone ?? randomPhone();
    const order = await createOrder(prisma, {
      userId: ctv.id,
      referrerUserId: ctv.id,
      placedForCustomer: true,
      source: 'ctv_assisted',
      endCustomerKey: customerPhone,
      status: opts.status,
      paymentMethod: opts.paymentMethod,
      paymentStatus: opts.paymentStatus,
      total,
      subtotal: total,
      shippingAddress: {
        recipient: 'Khach That',
        phone: customerPhone,
        street: '1 Duong IT',
        ward: 'Phuong IT',
        district: '',
        province: 'Ha Noi',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    const commission = await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id,
        orderId: order.id,
        orderTotal: total,
        commissionableTotal: total,
        rate: 10,
        amount: Math.floor(total / 10),
        status: opts.status === 'DELIVERED' ? 'LOCKED' : 'PENDING',
      },
    });
    return { ctv, order, customerPhone, commission };
  }

  it('admin huỷ đơn hộ BANK_TRANSFER đã PAID, khách có tài khoản → ví khách +total, ví CTV = 0, hoa hồng REJECTED', async () => {
    const customer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, phone: randomPhone() });
    const { ctv, order, commission } = await assistedOrder({
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 200_000,
      customerPhone: customer.phone!,
    });

    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(await walletOf(ctv.id)).toBe(0);
    expect(await walletOf(customer.id)).toBe(200_000);
    const refund = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({
      method: 'WALLET',
      status: 'COMPLETED',
      customerUserId: customer.id,
      amount: 200_000,
      orderCode: order.code,
      reason: 'CANCELLED',
    });
    const c = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(c.status).toBe('REJECTED');
  });

  it('khách cuối KHÔNG có tài khoản → yêu cầu hoàn thủ công PENDING (SĐT, số tiền, mã đơn), ví CTV = 0', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 310_000,
    });

    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

    expect(await walletOf(ctv.id)).toBe(0);
    const refund = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      customerUserId: null,
      phone: customerPhone,
      recipientName: 'Khach That',
      amount: 310_000,
      orderCode: order.code,
    });
  });

  it('CTV nhập SĐT của chính mình làm khách → KHÔNG hoàn vào ví CTV, thành yêu cầu hoàn thủ công', async () => {
    const phone = randomPhone();
    const { ctv, order } = await assistedOrder({
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      customerPhone: phone,
      ctvPhone: phone,
    });

    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

    expect(await walletOf(ctv.id)).toBe(0);
    const refund = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund.method).toBe('MANUAL_TRANSFER');
    expect(refund.customerUserId).toBeNull();
  });

  it('CTV tự huỷ đơn hộ đã PAID → bị từ chối, đơn/tiền giữ nguyên', async () => {
    const { ctv, order } = await assistedOrder({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });

    await expect(orders.cancel(ctv.id, order.code)).rejects.toBeInstanceOf(BadRequestException);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(after.paymentStatus).toBe('PAID');
    expect(await walletOf(ctv.id)).toBe(0);
    expect(await prisma.orderCustomerRefund.findUnique({ where: { orderId: order.id } })).toBeNull();
  });

  it('CTV tự huỷ đơn hộ CHƯA thanh toán → huỷ được, không có khoản hoàn nào, hoa hồng REJECTED', async () => {
    const { ctv, order, commission } = await assistedOrder({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
    });

    await orders.cancel(ctv.id, order.code);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.paymentStatus).toBe('UNPAID');
    expect(await walletOf(ctv.id)).toBe(0);
    expect(await prisma.orderCustomerRefund.findUnique({ where: { orderId: order.id } })).toBeNull();
    const c = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(c.status).toBe('REJECTED');
  });

  it('admin duyệt trả hàng đơn hộ COD đã giao → ví khách +total, ví CTV = 0, hoa hồng LOCKED bị REJECTED', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 5_000, phone: randomPhone() });
    const { ctv, order, commission } = await assistedOrder({
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      total: 450_000,
      customerPhone: customer.phone!,
    });
    const req = await prisma.returnRequest.create({
      data: { orderId: order.id, userId: ctv.id, reason: 'Hàng lỗi', status: 'REQUESTED' },
    });

    await admin.reviewReturn(adminUser.id, req.id, true, 'Đồng ý');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(await walletOf(ctv.id)).toBe(0);
    expect(await walletOf(customer.id)).toBe(455_000);
    const refund = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({ method: 'WALLET', status: 'COMPLETED', reason: 'RETURNED', amount: 450_000 });
    const c = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(c.status).toBe('REJECTED');
  });

  it('COD đã giao rồi admin chuyển RETURNED (setStatus) → yêu cầu hoàn thủ công, ví CTV = 0', async () => {
    const { ctv, order } = await assistedOrder({
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      total: 180_000,
    });

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });

    expect(await walletOf(ctv.id)).toBe(0);
    const refund = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 180_000, reason: 'RETURNED' });
  });

  it('2 admin huỷ đồng thời đơn hộ PAID → đúng 1 khoản hoàn, ví khách cộng 1 lần', async () => {
    const customer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, phone: randomPhone() });
    const { ctv, order } = await assistedOrder({
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 270_000,
      customerPhone: customer.phone!,
    });

    const results = await Promise.allSettled([
      orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
      orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
      orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
    ]);
    const s = summarize(results);
    expect(s.errors).toEqual([]);

    expect(await walletOf(ctv.id)).toBe(0);
    expect(await walletOf(customer.id)).toBe(270_000);
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('admin xác nhận đã chuyển khoản hoàn thủ công: 2 lần bấm đồng thời → 1 thắng, dòng COMPLETED có bankRef', async () => {
    const refunds = moduleRef.get(CustomerRefundsService);
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { order } = await assistedOrder({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });
    const pending = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { orderId: order.id } });

    const listed = await refunds.list('PENDING', 1, 100);
    expect(listed.data.map((r) => r.id)).toContain(pending.id);

    const results = await Promise.allSettled([
      refunds.markPaid(adminUser.id, pending.id, { bankRef: 'FT001' }),
      refunds.markPaid(adminUser.id, pending.id, { bankRef: 'FT002' }),
    ]);
    const s = summarize(results);
    expect(s.fulfilled.length).toBe(1);
    expect(s.rejected.length).toBe(1);
    const done = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: pending.id } });
    expect(done.status).toBe('COMPLETED');
    expect(done.completedBy).toBe(adminUser.id);
    expect(['FT001', 'FT002']).toContain(done.bankRef);
  });

  it('đơn thường (không phải đơn hộ) vẫn hoàn vào ví người đặt như cũ, không tạo dòng hoàn khách cuối', async () => {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 120_000,
      subtotal: 120_000,
    });

    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

    expect(await walletOf(buyer.id)).toBe(120_000);
    expect(await prisma.orderCustomerRefund.findUnique({ where: { orderId: order.id } })).toBeNull();
  });
});
