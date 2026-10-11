import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { ReviewInviteService } from '../../src/modules/lifecycle/review-invite.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * C-017 (A1-003) trên Postgres thật:
 *  - Mã giảm giá đơn thứ 2: chỉ khách thật có đúng MỘT đơn (đã giao đủ số ngày chờ, còn trong cửa sổ NS-1 30 ngày),
 *    mỗi khách một mã cả đời, hai instance cron chạy song song vẫn chỉ một mã + một tin.
 *  - Tin mời đánh giá: một lần mỗi đơn đã giao, chỉ liệt kê SP chưa đánh giá (Q-30 một đánh giá/SP), gửi lỗi thì
 *    trả cờ để lượt sau thử lại.
 */
describe('C-017 đơn thứ 2 + mời đánh giá (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;

  const DAY = 864e5;
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const phoneUser = () => createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
  const secondCoupons = (userId: string) =>
    prisma.coupon.findMany({ where: { code: { startsWith: 'SECOND-ORDER-' }, scopeMeta: { path: ['userId'], equals: userId } } });
  const notifiedWith = (code: string, userId: string) =>
    notify.mock.calls.filter((c: unknown[]) => c[0] === userId && c[1] === code);

  async function createVariation(name: string) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name, description: 'IT', basePrice: 100_000 },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        affiliateRate: 10,
        stock: 50,
      },
      include: { product: true },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(SystemConfigService);
    await warmPool(prisma);
  });

  beforeEach(() => notify.mockClear());

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('mã giảm giá đơn thứ 2', () => {
    it('(a) khách thật một đơn đã giao: đúng 1 mã hạn tới hết cửa sổ 30 ngày; 2 instance song song + chạy lại không cấp trùng', async () => {
      const u = await phoneUser();
      const first = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5) });

      const a = new VouchersService(prisma, config, notifications);
      const b = new VouchersService(prisma, config, notifications);
      const results = await Promise.all([a.secondOrderVouchers(), b.secondOrderVouchers()]);
      await a.secondOrderVouchers();

      const coupons = await secondCoupons(u.id);
      console.log('[a] results=%j coupons=%d notify=%d', results, coupons.length, notifiedWith('SECOND_ORDER_VOUCHER', u.id).length);
      expect(coupons).toHaveLength(1);
      expect(coupons[0]!.usageLimit).toBe(1);
      expect(coupons[0]!.scope).toBe('USER_GROUP');
      expect(Math.abs(coupons[0]!.endAt.getTime() - (first.createdAt.getTime() + 30 * DAY))).toBeLessThan(1000);
      expect(notifiedWith('SECOND_ORDER_VOUCHER', u.id)).toHaveLength(1);
    });

    it('(b) không cấp: guest, đã có đơn thứ 2, giao chưa đủ ngày, sắp hết cửa sổ, đơn lên hộ, đơn đại lý, đơn định kỳ', async () => {
      const guest = await createUser(prisma, { zaloId: `guest_d_${randCode(20)}` });
      await createOrder(prisma, { userId: guest.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5) });

      const hasSecond = await phoneUser();
      await createOrder(prisma, { userId: hasSecond.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5) });
      await createOrder(prisma, { userId: hasSecond.id, status: 'PENDING_PAYMENT', createdAt: ago(1) });

      const tooFresh = await phoneUser();
      await createOrder(prisma, { userId: tooFresh.id, status: 'DELIVERED', createdAt: ago(3), deliveredAt: ago(1) });

      const windowEnding = await phoneUser();
      await createOrder(prisma, { userId: windowEnding.id, status: 'DELIVERED', createdAt: ago(29), deliveredAt: ago(20) });

      const proxy = await phoneUser();
      await createOrder(prisma, { userId: proxy.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5), placedForCustomer: true });

      const dealer = await createUser(prisma, { phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, role: 'DEALER' });
      await createOrder(prisma, { userId: dealer.id, type: 'DEALER', status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5) });

      const subscriber = await phoneUser();
      await createOrder(prisma, { userId: subscriber.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5), subscriptionId: `sub-${randCode(6)}` });

      // Đơn huỷ không tính là "đơn khác": khách này vẫn chỉ có một đơn thật.
      const withCancelled = await phoneUser();
      await createOrder(prisma, { userId: withCancelled.id, status: 'CANCELLED', createdAt: ago(12) });
      await createOrder(prisma, { userId: withCancelled.id, status: 'DELIVERED', createdAt: ago(10), deliveredAt: ago(5) });

      await new VouchersService(prisma, config, notifications).secondOrderVouchers();

      const counts = await Promise.all(
        [guest, hasSecond, tooFresh, windowEnding, proxy, dealer, subscriber, withCancelled].map((u) => secondCoupons(u.id).then((c) => c.length)),
      );
      console.log('[b] guest,hasSecond,tooFresh,windowEnding,proxy,dealer,subscriber,withCancelled=%j', counts);
      expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    });

    it('(c) vượt một lô: mọi khách đủ điều kiện đều nhận, không sót', async () => {
      const statics = VouchersService as unknown as { SECOND_ORDER_PAGE: number };
      const original = statics.SECOND_ORDER_PAGE;
      statics.SECOND_ORDER_PAGE = 2;
      try {
        const users = [];
        for (let i = 0; i < 5; i++) {
          const u = await phoneUser();
          await createOrder(prisma, { userId: u.id, status: 'DELIVERED', createdAt: ago(8), deliveredAt: ago(4) });
          users.push(u);
        }
        await new VouchersService(prisma, config, notifications).secondOrderVouchers();
        const counts = await Promise.all(users.map((u) => secondCoupons(u.id).then((c) => c.length)));
        console.log('[c] counts=%j', counts);
        expect(counts).toEqual(users.map(() => 1));
      } finally {
        statics.SECOND_ORDER_PAGE = original;
      }
    });
  });

  describe('tin mời đánh giá sau giao', () => {
    it('(d) chỉ nhắc SP chưa đánh giá, một lần mỗi đơn kể cả 2 instance song song; đơn đã đánh giá hết thì đánh dấu, không gửi', async () => {
      const u = await phoneUser();
      const [v1, v2] = [await createVariation('Dầu gội IT'), await createVariation('Sữa tắm IT')];
      const order = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', createdAt: ago(6), deliveredAt: ago(3) });
      await prisma.orderItem.createMany({
        data: [v1, v2].map((v) => ({
          orderId: order.id,
          variationId: v.id,
          productName: v.product.name,
          productSlug: v.product.slug,
          variationName: v.name,
          unitPrice: 100_000,
          quantity: 1,
          total: 100_000,
        })),
      });
      await prisma.review.create({ data: { userId: u.id, productId: v1.productId, orderId: order.id, rating: 5 } });

      const allReviewed = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', createdAt: ago(6), deliveredAt: ago(3) });
      await prisma.orderItem.create({
        data: { orderId: allReviewed.id, variationId: v1.id, productName: v1.product.name, variationName: v1.name, unitPrice: 1, quantity: 1, total: 1 },
      });

      const a = new ReviewInviteService(prisma, config, notifications);
      const b = new ReviewInviteService(prisma, config, notifications);
      await Promise.all([a.sendReviewInvites(), b.sendReviewInvites()]);
      await a.sendReviewInvites();

      const calls = notifiedWith('REVIEW_REQUEST', u.id);
      console.log('[d] review calls=%j', calls.map((c: unknown[]) => c[2]));
      expect(calls).toHaveLength(1);
      expect(calls[0]![2]).toMatchObject({ order_code: order.code, product: 'Sữa tắm IT', product_slug: v2.product.slug });
      const marks = await prisma.order.findMany({ where: { id: { in: [order.id, allReviewed.id] } }, select: { reviewInvitedAt: true } });
      expect(marks.every((m) => m.reviewInvitedAt !== null)).toBe(true);
    });

    it('(e) chưa tới giờ, quá cũ, đơn đại lý, đơn lên hộ: không gửi; gửi lỗi thì trả cờ và lượt sau gửi lại', async () => {
      const u = await phoneUser();
      const v = await createVariation('Nước rửa chén IT');
      const mk = async (over: Parameters<typeof createOrder>[1]) => {
        const o = await createOrder(prisma, over);
        await prisma.orderItem.create({
          data: { orderId: o.id, variationId: v.id, productName: v.product.name, productSlug: v.product.slug, variationName: v.name, unitPrice: 1, quantity: 1, total: 1 },
        });
        return o;
      };
      const fresh = await mk({ userId: u.id, status: 'DELIVERED', createdAt: ago(2), deliveredAt: new Date(Date.now() - 3600e3) });
      const stale = await mk({ userId: u.id, status: 'DELIVERED', createdAt: ago(40), deliveredAt: ago(30) });
      const dealerOrder = await mk({ userId: u.id, type: 'DEALER', status: 'DELIVERED', createdAt: ago(6), deliveredAt: ago(3) });
      const proxyOrder = await mk({ userId: u.id, placedForCustomer: true, status: 'DELIVERED', createdAt: ago(6), deliveredAt: ago(3) });
      const due = await mk({ userId: u.id, status: 'DELIVERED', createdAt: ago(6), deliveredAt: ago(3) });

      notify.mockImplementation(async (userId: string, code: string) => {
        if (userId === u.id && code === 'REVIEW_REQUEST') throw new Error('ZNS down');
      });
      await new ReviewInviteService(prisma, config, notifications).sendReviewInvites();
      const afterFail = await prisma.order.findUnique({ where: { id: due.id }, select: { reviewInvitedAt: true } });
      notify.mockReset();
      notify.mockResolvedValue(undefined);

      await new ReviewInviteService(prisma, config, notifications).sendReviewInvites();
      const calls = notifiedWith('REVIEW_REQUEST', u.id);
      const marks = await prisma.order.findMany({
        where: { id: { in: [fresh.id, stale.id, dealerOrder.id, proxyOrder.id] } },
        select: { reviewInvitedAt: true },
      });
      console.log('[e] afterFail=%j calls=%j', afterFail, calls.map((c: unknown[]) => c[2]));
      expect(afterFail?.reviewInvitedAt).toBeNull();
      expect(calls).toHaveLength(1);
      expect(calls[0]![2]).toMatchObject({ order_code: due.code });
      expect(marks.every((m) => m.reviewInvitedAt === null)).toBe(true);
    });
  });
});
