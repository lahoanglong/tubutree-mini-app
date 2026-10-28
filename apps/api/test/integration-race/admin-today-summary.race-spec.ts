import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminReportsService } from '../../src/modules/admin/admin-reports.service';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Trang "Hôm nay" và trang Báo cáo doanh thu phải ra CÙNG số cho cùng khoảng ngày giờ VN: đếm mọi đơn (kể cả huỷ/trả), doanh thu
 * = đơn đã thu trừ hoàn một phần đã duyệt, khách mới theo NEW_CUSTOMER_SQL. Chạy trên Postgres thật; khoảng tháng 9/2019
 * không có dữ liệu của spec khác (createdAt đặt tay).
 */
describe('Hôm nay khớp Báo cáo doanh thu (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      const orderIds = (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o) => o.id);
      await prisma.$transaction([
        prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  const mkUser = async (data: Parameters<typeof createUser>[1] = {}) => {
    const u = await createUser(prisma, data);
    userIds.push(u.id);
    return u;
  };

  it('đơn, doanh thu (trừ hoàn một phần) và khách mới của hôm nay, hôm qua, 7 ngày bằng đúng số của Báo cáo', async () => {
    // 2019-09-12 05:00Z = 12:00 giờ VN. Hôm nay 12/9, hôm qua 11/9, 7 ngày = 6/9..12/9.
    const now = new Date('2019-09-12T05:00:00Z');
    const T = new Date('2019-09-12T03:00:00Z');
    const Y = new Date('2019-09-11T03:00:00Z');
    const W = new Date('2019-09-07T03:00:00Z');
    const OLD = new Date('2019-09-05T03:00:00Z');
    const buyer = await mkUser();
    const mk = (createdAt: Date, over: Parameters<typeof createOrder>[1] extends infer X ? Partial<X> : never) =>
      createOrder(prisma, { userId: buyer.id, source: 'checkout', platform: 'miniapp', createdAt, ...over });
    const partial = (orderId: string, status: 'APPROVED' | 'REQUESTED', refundAmount: number | null, shippingRefund = 0) =>
      prisma.returnRequest.create({ data: { orderId, userId: buyer.id, reason: 'IT', status, refundAmount, shippingRefund } });

    const paid = await mk(T, { status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 1_000_000 });
    await partial(paid.id, 'APPROVED', 150_000, 50_000);
    await partial(paid.id, 'REQUESTED', 999_000);
    await mk(T, { status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 70_000 });
    await mk(T, { status: 'CANCELLED', paymentMethod: 'ZALOPAY', paymentStatus: 'REFUNDED', total: 99_000 });
    await mk(T, { status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED', total: 60_000 });
    await mk(T, { status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 45_000 });
    const yPaid = await mk(Y, { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 300_000 });
    await partial(yPaid.id, 'APPROVED', 100_000);
    await mk(W, { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 80_000 });
    await mk(OLD, { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 5_000_000 });

    await mkUser({ createdAt: T, phone: '0911000001' });
    await mkUser({ createdAt: T, role: 'STAFF' });
    await mkUser({ createdAt: T, role: 'ADMIN' });
    await mkUser({ createdAt: Y });
    // Phiên khách vãng lai (guest_, không SĐT) không phải tài khoản thật: cả Hôm nay lẫn Báo cáo đều không đếm.
    await mkUser({ createdAt: T, zaloId: `guest_it_${Date.now()}_t` });
    await mkUser({ createdAt: Y, zaloId: `guest_it_${Date.now()}_y` });
    await mkUser({ createdAt: W });
    await mkUser({ createdAt: T, firstTouchAt: new Date(T.getTime() + 5 * 864e5), firstTouchSource: 'shopee' });
    await mkUser({ createdAt: OLD });
    const target = await mkUser({ createdAt: T });
    await mkUser({ createdAt: T, mergedIntoId: target.id });

    const none = {} as never;
    const admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    const reports = new AdminReportsService(prisma);
    const today = await admin.getTodaySummary(now);

    const range = async (from: string, to: string) => (await reports.revenueReport({ from, to }, now)).totals;
    const t = await range('2019-09-12', '2019-09-12');
    const y = await range('2019-09-11', '2019-09-11');
    const w = await range('2019-09-06', '2019-09-12');

    expect(today.orders).toEqual({ today: t.orders, yesterday: y.orders, week: w.orders });
    expect(today.revenue).toEqual({ today: t.revenue, yesterday: y.revenue, week: w.revenue });
    expect(today.newUsers).toEqual({ today: t.newUsers, yesterday: y.newUsers, week: w.newUsers });

    // Số cụ thể, để lệch cả hai bên cùng lúc cũng bị bắt.
    expect(today.orders).toEqual({ today: 5, yesterday: 1, week: 7 });
    expect(today.revenue).toEqual({ today: 1_000_000 - 200_000 + 70_000, yesterday: 200_000, week: 1_000_000 - 200_000 + 70_000 + 200_000 + 80_000 });
    // Hôm nay: người có SĐT và target; loại STAFF, ADMIN, khách cũ gắn nguồn muộn và dòng đã gộp. (buyer tạo ở ngày thật nên ngoài khoảng.)
    expect(today.newUsers).toEqual({ today: 2, yesterday: 1, week: 4 });
  });
});
