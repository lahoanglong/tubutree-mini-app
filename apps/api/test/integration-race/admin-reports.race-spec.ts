import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminReportsService } from '../../src/modules/admin/admin-reports.service';
import { orderCsvChunks } from '../../src/modules/admin/admin-export';
import { orderItemCsvChunks } from '../../src/modules/admin/admin-order-items-export';
import { REVENUE_ORDER_WHERE } from '../../src/modules/admin/admin-revenue';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Báo cáo admin (D1-04, D2-02, D1-14) trên Postgres THẬT. DB race dùng chung với spec khác nên mỗi ca dùng một khoảng ngày
 * riêng trong quá khứ xa (createdAt đặt tay) và/hoặc lọc theo người dùng của chính ca đó.
 */
describe('Báo cáo admin (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const storefrontIds: string[] = [];

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
        prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } }),
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

  async function collect(gen: AsyncGenerator<string>) {
    let out = '';
    for await (const c of gen) out += c;
    return out;
  }

  describe('D1-04a: CSV đơn có nguồn, CTV, gian hàng; CSV theo dòng hàng', () => {
    it('đơn gian hàng của CTV ghi đủ nền tảng/nguồn/CTV/gian hàng, dòng hàng mang SKU', async () => {
      const buyer = await mkUser();
      const ctv = await mkUser({ role: 'AFFILIATE', fullName: 'CTV Lan', phone: `09${randCode(8).replace(/\D/g, '1').padEnd(8, '1').slice(0, 8)}` });
      const store = await prisma.storefront.create({
        data: { type: 'CTV', slug: `it-rp-${randCode(8).toLowerCase()}`, ownerUserId: ctv.id, title: 'Gian hàng Lan', isPublished: true },
      });
      storefrontIds.push(store.id);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        source: 'storefront',
        platform: 'miniapp',
        referrerUserId: ctv.id,
        storefrontSlug: store.slug,
        storefrontId: store.id,
        total: 150_000,
      });
      await prisma.orderItem.create({
        data: { orderId: order.id, variationId: 'it-var-missing', productName: 'Mật ong', variationName: '500ml', unitPrice: 75_000, quantity: 2, total: 150_000 },
      });

      const csv = await collect(orderCsvChunks(prisma, { id: order.id }));
      const [header, line] = csv.trimEnd().split('\r\n');
      expect(header!.endsWith('Nền tảng,Nguồn đơn,CTV giới thiệu,SĐT CTV,Gian hàng')).toBe(true);
      expect(line).toContain(',Mini App,Gian hàng (khách tự mua),CTV Lan,');
      expect(line!.endsWith(',Gian hàng Lan')).toBe(true);

      const items = await collect(orderItemCsvChunks(prisma, { id: order.id }));
      const rows = items.trimEnd().split('\r\n');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain(',Mật ong,500ml,2,75000,150000,');
      expect(rows[1]).toContain(',Gian hàng (khách tự mua),CTV Lan,Gian hàng Lan,');
    });
  });

  describe('D1-04b: doanh thu theo ngày × kênh khớp sổ (KPI tổng quan)', () => {
    let reports: AdminReportsService;
    let admin: AdminService;
    beforeAll(() => {
      reports = new AdminReportsService(prisma);
      const none = {} as never;
      admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    });

    // 2019-03-10 05:00Z = 12:00 giờ VN. Khoảng 2019 không có đơn của spec khác.
    const at = (iso: string) => new Date(iso);
    const D10 = at('2019-03-10T05:00:00Z');
    const D11 = at('2019-03-11T05:00:00Z');

    async function seed() {
      const u = await mkUser();
      const dealer = await mkUser({ role: 'DEALER' });
      const mk = (over: Parameters<typeof createOrder>[1] extends infer T ? Partial<T> : never) =>
        createOrder(prisma, { userId: u.id, source: 'checkout', platform: 'miniapp', createdAt: D10, ...over });
      const partial = async (orderId: string, status: 'APPROVED' | 'REQUESTED', refundAmount: number | null, shippingRefund = 0) =>
        prisma.returnRequest.create({ data: { orderId, userId: u.id, reason: 'IT', status, refundAmount, shippingRefund } });

      // Ngày 10 (VN)
      await mk({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 70_000 });
      await mk({ status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 80_000 });
      const sf = await mk({ source: 'storefront', status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 120_000 });
      await partial(sf.id, 'APPROVED', 30_000, 5_000);
      await partial(sf.id, 'REQUESTED', null);
      await mk({ status: 'CANCELLED', paymentMethod: 'ZALOPAY', paymentStatus: 'REFUNDED', total: 99_000 });
      await mk({ status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 45_000 });
      await mk({ status: 'RETURNED', paymentMethod: 'COD', paymentStatus: 'REFUNDED', total: 60_000 });
      const dl = await createOrder(prisma, {
        userId: dealer.id, type: 'DEALER', source: 'dealer', platform: 'web', createdAt: D10,
        status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 5_000_000,
      });
      await partial(dl.id, 'APPROVED', 200_000);
      await createOrder(prisma, {
        userId: dealer.id, type: 'DEALER', source: 'dealer', platform: 'web', createdAt: D10,
        status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 300_000,
      });
      await mk({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 200_000, fulfiller: 'MERCHANT' });
      // Biên ngày VN: 23:59:59 ngày 10 vẫn là ngày 10, 00:00:00 ngày 11 là ngày 11.
      await mk({ createdAt: at('2019-03-10T16:59:59Z'), status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 11_000 });
      await mk({ createdAt: at('2019-03-10T17:00:00Z'), status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 22_000 });
      // Đơn cũ chưa ghi nguồn/nền tảng
      await mk({ createdAt: D11, source: null, platform: null, status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 10_000 });
      // Ngoài khoảng 10..11
      await mk({ createdAt: at('2019-03-11T17:00:00Z'), status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 33_000 });
      await mk({ createdAt: at('2019-03-09T16:59:59Z'), status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 44_000 });
    }

    it('tổng báo cáo = tổng đơn tính tay (huỷ/trả/hoàn một phần/đại lý/COD đối tác) và bằng KPI tổng quan', async () => {
      const before = await admin.getDashboardStats();
      await seed();
      const after = await admin.getDashboardStats();

      const r = await reports.revenueReport({ from: '2019-03-10', to: '2019-03-11' });
      expect(r.range).toMatchObject({ from: '2019-03-10', to: '2019-03-11', days: 2 });
      // 70k COD giao + 80k + (120k-30k-5k) + (5M-200k) + 11k + 22k + 10k
      const revenue = 70_000 + 80_000 + (120_000 - 30_000 - 5_000) + (5_000_000 - 200_000) + 11_000 + 22_000 + 10_000;
      expect(r.totals.revenue).toBe(revenue);
      expect(r.totals.gross).toBe(revenue + 35_000 + 200_000);
      expect(r.totals.partialRefund).toBe(35_000 + 200_000);
      expect(r.totals.cancelled).toBe(3);
      // đơn đặt (mọi trạng thái): 12 đơn trong khoảng 10..11
      expect(r.totals.orders).toBe(12);
      expect(r.totals.paidOrders).toBe(7);
      expect(r.totals.gmv).toBe(70_000 + 80_000 + 120_000 + 5_000_000 + 300_000 + 200_000 + 11_000 + 22_000 + 10_000);

      // Theo ngày × kênh
      const cell = (day: string, channel: string) => r.byDay.find((x) => x.day === day && x.channel === channel);
      expect(cell('2019-03-10', 'checkout')).toMatchObject({ orders: 7, cancelled: 3, paidOrders: 3, revenue: 70_000 + 80_000 + 11_000 });
      expect(cell('2019-03-10', 'storefront')).toMatchObject({ orders: 1, paidOrders: 1, revenue: 85_000 });
      expect(cell('2019-03-10', 'dealer')).toMatchObject({ orders: 2, paidOrders: 1, revenue: 4_800_000 });
      expect(cell('2019-03-11', 'checkout')).toMatchObject({ orders: 1, revenue: 22_000 });
      expect(cell('2019-03-11', 'unknown')).toMatchObject({ orders: 1, revenue: 10_000 });
      expect(r.byDay.reduce((s, x) => s + x.revenue, 0)).toBe(revenue);
      expect(r.byChannel.reduce((s, x) => s + x.revenue, 0)).toBe(revenue);
      expect(r.byPlatform.reduce((s, x) => s + x.revenue, 0)).toBe(revenue);
      expect(r.byChannel.map((c) => c.key)).toEqual(['dealer', 'checkout', 'storefront', 'unknown']);
      expect(r.byChannel[0]!.label).toBe('Đại lý');

      // Khoảng rộng hơn lấy thêm đúng hai đơn ngoài khoảng 10..11 (33k ngày 12, 44k ngày 9)
      const wide = await reports.revenueReport({ from: '2019-03-09', to: '2019-03-12' });
      expect(wide.totals.revenue).toBe(revenue + 33_000 + 44_000);
      // Cả bảng: chênh lệch KPI tổng quan (tính mọi thời gian) đúng bằng báo cáo của khoảng chứa mọi đơn vừa tạo
      expect(after.totalRevenue - before.totalRevenue).toBe(wide.totals.revenue);
      expect(after.gmv - before.gmv).toBe(wide.totals.gmv);
    });

    it('khoảng ngày không có đơn: mọi số 0; khoảng quá 366 ngày bị từ chối', async () => {
      const r = await reports.revenueReport({ from: '2001-01-01', to: '2001-01-31' });
      expect(r.totals).toMatchObject({ orders: 0, revenue: 0 });
      expect(r.byDay).toEqual([]);
      await expect(reports.revenueReport({ from: '2018-01-01', to: '2019-03-01' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('D2-02: nguồn chạm đầu × tuần', () => {
    let reports: AdminReportsService;
    beforeAll(() => {
      reports = new AdminReportsService(prisma);
    });
    const DAY = 864e5;
    // 2019-04-01 là thứ Hai. Người dùng tạo lúc 12:00 giờ VN thứ Tư (05:00Z).
    const W1 = new Date('2019-04-03T05:00:00Z');
    const W2 = new Date('2019-04-10T05:00:00Z');

    async function seedCohorts() {
      const made: Record<string, { id: string; createdAt: Date }> = {};
      const user = async (key: string, over: Parameters<typeof createUser>[1] = {}, createdAt = W1) => {
        const u = await mkUser({ createdAt, ...over });
        made[key] = { id: u.id, createdAt };
        return u;
      };
      const order = (key: string, days: number, over: Partial<Parameters<typeof createOrder>[1]> = {}) =>
        createOrder(prisma, {
          userId: made[key]!.id,
          status: 'CONFIRMED',
          paymentMethod: 'ZALOPAY',
          paymentStatus: 'PAID',
          createdAt: new Date(made[key]!.createdAt.getTime() + days * DAY),
          ...over,
        });

      await user('A', { firstTouchSource: 'shopee' });
      await order('A', 2, { status: 'DELIVERED', total: 100_000 });
      await order('A', 10, { total: 50_000 });
      await user('B', { firstTouchSource: 'shopee' });
      const b1 = await order('B', 5, { total: 80_000 });
      await prisma.returnRequest.create({ data: { orderId: b1.id, userId: made.B!.id, reason: 'IT', status: 'APPROVED', refundAmount: 20_000 } });
      await order('B', 6, { status: 'CANCELLED', paymentStatus: 'REFUNDED', total: 30_000 });
      await user('C', { firstTouchSource: 'shopee' });
      await user('M', { firstTouchSource: 'shopee' });
      await order('M', 2, { status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', fulfiller: 'MERCHANT', total: 99_000 });
      await user('P', { firstTouchSource: 'shopee' }, new Date('2019-03-31T17:00:00Z'));
      await user('N', { firstTouchSource: 'shopee' }, new Date('2019-03-31T16:59:59Z'));
      await user('K', { firstTouchSource: 'shopee', role: 'ADMIN' });
      await user('D', { firstTouchSource: 'card-2610' });
      await order('D', 40, { total: 70_000 });
      await user('E', { firstTouchSource: 'ctv' });
      await order('E', 1, { status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 40_000 });
      await order('E', 45, { total: 60_000 });
      await user('F');
      await order('F', 1, { total: 10_000 });
      await user('G', { firstTouchSource: 'organic' });
      await order('G', 1, { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 90_000 });
      // Khách cũ được gắn nguồn lúc gộp khách (chạm đầu SAU ngày tạo): không phải khách mới của nguồn đó.
      await user('H', { firstTouchSource: 'fb', firstTouchAt: new Date(W1.getTime() + 30 * DAY) });
      await order('H', 1, { total: 500_000 });
      // Chạm đầu lưu trên máy từ trước khi tạo tài khoản: vẫn là khách mới.
      await user('I', { firstTouchSource: 'fb', firstTouchAt: new Date(W1.getTime() - 40 * DAY) });
      await order('I', 3, { total: 25_000 });
      await user('J', { firstTouchSource: 'ctv' }, W2);
      await order('J', 2, { total: 15_000 });
      await order('J', 3, { total: 5_000 });
      return made;
    }

    it('khách mới, đơn đầu, đơn hai trong 30 ngày và doanh thu theo nguồn × tuần khớp số tính tay và khớp định nghĩa doanh thu', async () => {
      const made = await seedCohorts();
      const r = await reports.sourceReport({ from: '2019-04-01', to: '2019-04-14' }, new Date('2019-04-20T00:00:00Z'));
      expect(r.range).toMatchObject({ from: '2019-04-01', to: '2019-04-14', days: 14 });
      const cell = (week: string, source: string) => r.rows.find((x) => x.week === week && x.source === source);
      const pick = (c: ReturnType<typeof cell>) => c && { newUsers: c.newUsers, firstOrderUsers: c.firstOrderUsers, secondOrderUsers: c.secondOrderUsers, revenue: c.revenue };

      expect(pick(cell('2019-04-01', 'shopee'))).toEqual({ newUsers: 5, firstOrderUsers: 3, secondOrderUsers: 1, revenue: 210_000 });
      expect(pick(cell('2019-04-01', 'card-2610'))).toEqual({ newUsers: 1, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 });
      expect(pick(cell('2019-04-01', 'ctv'))).toEqual({ newUsers: 1, firstOrderUsers: 1, secondOrderUsers: 0, revenue: 40_000 });
      expect(pick(cell('2019-04-01', 'unknown'))).toEqual({ newUsers: 1, firstOrderUsers: 1, secondOrderUsers: 0, revenue: 10_000 });
      expect(pick(cell('2019-04-01', 'organic'))).toEqual({ newUsers: 1, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 });
      expect(pick(cell('2019-04-01', 'fb'))).toEqual({ newUsers: 1, firstOrderUsers: 1, secondOrderUsers: 0, revenue: 25_000 });
      expect(pick(cell('2019-04-08', 'ctv'))).toEqual({ newUsers: 1, firstOrderUsers: 1, secondOrderUsers: 1, revenue: 20_000 });
      expect(r.rows).toHaveLength(7);
      expect(r.totals).toEqual({ newUsers: 11, firstOrderUsers: 7, secondOrderUsers: 2, revenue: 305_000 });
      expect(r.bySource[0]).toMatchObject({ source: 'shopee', newUsers: 5, label: 'Shopee' });
      // Ngày 20/04 mới 17 ngày sau tuần 04-08 và 19 ngày sau tuần 04-01: chưa kỳ nào đóng
      expect(r.rows.every((x) => !x.firstWindowClosed && !x.secondWindowClosed)).toBe(true);

      // Đối chiếu độc lập: doanh thu của chính các khách đó theo định nghĩa doanh thu dùng chung (Prisma, không qua SQL của báo cáo)
      let expected = 0;
      for (const key of ['A', 'B', 'C', 'M', 'P', 'D', 'E', 'F', 'G', 'I', 'J']) {
        const u = made[key]!;
        const where = { userId: u.id, createdAt: { lt: new Date(u.createdAt.getTime() + 30 * DAY) }, ...REVENUE_ORDER_WHERE };
        const gross = (await prisma.order.aggregate({ _sum: { total: true }, where }))._sum.total ?? 0;
        const orderIds = (await prisma.order.findMany({ where, select: { id: true } })).map((o) => o.id);
        const refunds = await prisma.returnRequest.findMany({ where: { status: 'APPROVED', orderId: { in: orderIds } }, select: { refundAmount: true, shippingRefund: true } });
        expected += gross - refunds.reduce((sum, x) => sum + (x.refundAmount ?? 0) + x.shippingRefund, 0);
      }
      expect(r.totals.revenue).toBe(expected);
    });

    it('kỳ đã đóng khi đủ ngày; khoảng quá 180 ngày bị từ chối; khoảng không có khách mới rỗng', async () => {
      const closed = await reports.sourceReport({ from: '2019-04-01', to: '2019-04-14' }, new Date('2019-12-31T00:00:00Z'));
      expect(closed.rows.every((x) => x.firstWindowClosed && x.secondWindowClosed)).toBe(true);
      await expect(reports.sourceReport({ from: '2018-10-01', to: '2019-04-14' })).rejects.toBeInstanceOf(BadRequestException);
      const none = await reports.sourceReport({ from: '2001-01-01', to: '2001-01-31' });
      expect(none.rows).toEqual([]);
      expect(none.totals).toEqual({ newUsers: 0, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 });
    });
  });
});
