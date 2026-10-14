import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser } from './helpers';

/**
 * ADMINOPS-14 trên Postgres THẬT: KPI "Doanh thu" chỉ tính tiền đã thu (đã thanh toán, hoặc COD đã giao), trừ đơn
 * huỷ/trả/đã hoàn và phần đã hoàn của lần trả một phần. Giá trị đơn đặt (GMV) và tiền COD chưa thu tách riêng, đơn
 * trả hàng có ô riêng. So theo chênh lệch trước/sau vì DB race dùng chung với các spec khác (chạy --runInBand).
 */
describe('ADMINOPS-14 — KPI doanh thu (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('doanh thu = đã thu; GMV, COD chưa thu, đơn trả và tiền đã hoàn tách riêng', async () => {
    const before = await admin.getDashboardStats();
    const u = await createUser(prisma);
    await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 139_000 });
    await createOrder(prisma, { userId: u.id, status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 50_000 });
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 70_000 });
    await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 80_000 });
    await createOrder(prisma, { userId: u.id, status: 'CANCELLED', paymentMethod: 'ZALOPAY', paymentStatus: 'REFUNDED', total: 99_000 });
    await createOrder(prisma, { userId: u.id, status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 45_000 });
    await createOrder(prisma, { userId: u.id, status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED', total: 60_000 });
    const partial = await createOrder(prisma, {
      userId: u.id,
      status: 'DELIVERED',
      paymentMethod: 'ZALOPAY',
      paymentStatus: 'PAID',
      total: 100_000,
    });
    await prisma.returnRequest.create({
      data: { orderId: partial.id, userId: u.id, reason: 'IT', status: 'APPROVED', refundAmount: 30_000 },
    });
    await prisma.returnRequest.create({ data: { orderId: partial.id, userId: u.id, reason: 'IT', status: 'REQUESTED' } });

    const after = await admin.getDashboardStats();
    expect(after.totalRevenue - before.totalRevenue).toBe(70_000 + 80_000 + 100_000 - 30_000);
    expect(after.gmv - before.gmv).toBe(139_000 + 50_000 + 70_000 + 80_000 + 100_000);
    expect(after.codPendingValue - before.codPendingValue).toBe(139_000 + 50_000);
    expect(after.returnedOrders - before.returnedOrders).toBe(1);
    expect(after.returnRefundTotal - before.returnRefundTotal).toBe(30_000);
    expect(after.pendingReturns - before.pendingReturns).toBe(1);
    expect(after.cancelledOrders - before.cancelledOrders).toBe(2);
  });

  it('đơn đại lý ghi công nợ đã giao chưa trả: không vào doanh thu đã thu, hiện ở công nợ đại lý', async () => {
    const before = await admin.getDashboardStats();
    const dealer = await createUser(prisma, { role: 'DEALER' });
    const credit = await createOrder(prisma, {
      userId: dealer.id,
      type: 'DEALER',
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 5_000_000,
    });
    await prisma.dealerCreditLedger.create({
      data: { userId: dealer.id, delta: 5_000_000, refType: 'ORDER', refId: credit.id, note: 'IT' },
    });
    await prisma.returnRequest.create({
      data: { orderId: credit.id, userId: dealer.id, reason: 'IT', status: 'APPROVED', refundAmount: 200_000 },
    });
    await prisma.dealerCreditLedger.create({ data: { userId: dealer.id, delta: -1_000_000, refType: 'PAYMENT', note: 'IT' } });
    await createOrder(prisma, { userId: dealer.id, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 300_000 });

    const after = await admin.getDashboardStats();
    expect(after.totalRevenue - before.totalRevenue).toBe(0);
    expect(after.dealerDebtOutstanding - before.dealerDebtOutstanding).toBe(4_000_000);
  });
});
