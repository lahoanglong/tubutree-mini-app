import { Test, type TestingModule } from '@nestjs/testing';
import type { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Thống kê gian hàng CTV của đại lý (cờ isPartner): đơn khách mua qua slug của chính đại lý mà đại lý tự giao có referrerUserId
 * null (checkout referrerFor) nhưng vẫn là doanh số của gian hàng. Số kỳ vọng tính tay trong từng ca.
 */
describe('Thống kê gian hàng của đại lý: đơn tự giao qua slug riêng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let storefront: StorefrontService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    storefront = new StorefrontService(prisma, moduleRef.get(SystemConfigService), {} as never);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  type Line = { productSlug: string; productName: string; quantity: number; total: number };
  const honey = (quantity: number): Line => ({ productSlug: 'honey', productName: 'Mật ong', quantity, total: 260_000 * quantity });
  const pepper = (quantity: number): Line => ({ productSlug: 'pepper', productName: 'Tiêu', quantity, total: 100_000 * quantity });
  const tea: Line = { productSlug: 'tea', productName: 'Trà', quantity: 1, total: 50_000 };
  const DAY = 864e5;

  async function setup() {
    const dealer = await createUser(prisma, { role: 'DEALER' });
    const otherCtv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const slug = `it-dl-${randCode(8).toLowerCase()}`;
    const otherSlug = `it-dlo-${randCode(8).toLowerCase()}`;
    const store = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug, ownerUserId: dealer.id, title: 'Đại lý IT', isPublished: true },
    });
    await prisma.storefront.create({ data: { type: 'CTV', slug: otherSlug, ownerUserId: otherCtv.id, title: 'CTV khác', isPublished: true } });

    const mk = async (
      status: OrderStatus,
      paymentStatus: PaymentStatus,
      items: Line[],
      o: {
        referrer?: string | null;
        selfShip?: boolean;
        slug?: string;
        userId?: string;
        shippingFee?: number;
        discount?: number;
        ageDays?: number;
        placedForCustomer?: boolean;
      } = {},
    ) => {
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const shippingFee = o.shippingFee ?? 0;
      const discount = o.discount ?? 0;
      const order = await createOrder(prisma, {
        userId: o.userId ?? buyer.id,
        status,
        paymentStatus,
        subtotal,
        shippingFee,
        discount,
        couponDiscount: discount,
        total: subtotal + shippingFee - discount,
        referrerUserId: o.referrer === undefined ? null : o.referrer,
        storefrontSlug: o.slug ?? slug,
        storefrontId: (o.slug ?? slug) === slug ? store.id : null,
        fulfiller: o.selfShip ? 'MERCHANT' : 'TUBU',
        fulfillerStorefrontId: o.selfShip ? store.id : null,
        placedForCustomer: o.placedForCustomer ?? false,
        createdAt: new Date(Date.now() - (o.ageDays ?? 0) * DAY),
      });
      const rows = [];
      for (const i of items) {
        rows.push(
          await prisma.orderItem.create({
            data: { orderId: order.id, variationId: 'it-var', variationName: 'v', unitPrice: i.total / i.quantity, ...i },
          }),
        );
      }
      return { order, items: rows };
    };
    const partialReturn = async (orderId: string, orderItemId: string, quantity: number, refundAmount: number, shippingRefund = 0) => {
      const r = await prisma.returnRequest.create({
        data: { orderId, userId: buyer.id, reason: 'IT', status: 'APPROVED', refundAmount, shippingRefund, fullReturn: false },
      });
      await prisma.returnRequestItem.create({ data: { returnRequestId: r.id, orderItemId, quantity, refundAmount } });
    };
    return { dealer, otherCtv, buyer, slug, otherSlug, store, mk, partialReturn };
  }

  async function seedMixed() {
    const ctx = await setup();
    const { dealer, otherCtv, otherSlug, mk, partialReturn } = ctx;
    // Đơn giới thiệu (Tubu giao): 780k hàng + 30k ship − 10k mã giảm = 800k, tạo 10 ngày trước.
    const r1 = await mk('DELIVERED', 'PAID', [honey(3)], { referrer: dealer.id, shippingFee: 30_000, discount: 10_000, ageDays: 10 });
    await prisma.commission.create({ data: { affiliateUserId: dealer.id, orderId: r1.order.id, orderTotal: 800_000, rate: 0.1, amount: 78_000, status: 'APPROVED' } });
    // Đơn giới thiệu đã huỷ: không vào số đơn lẫn doanh thu.
    await mk('CANCELLED', 'UNPAID', [honey(1)], { referrer: dealer.id });
    // Đơn tự giao qua slug riêng (referrer null): 200k + 25k ship = 225k.
    await mk('CONFIRMED', 'UNPAID', [pepper(2)], { selfShip: true, shippingFee: 25_000 });
    // Vừa khớp người giới thiệu vừa khớp gian hàng giao: đếm một lần, 260k.
    await mk('DELIVERED', 'PAID', [honey(1)], { referrer: dealer.id, selfShip: true });
    // Tự giao nhưng huỷ / trả cả đơn / đã hoàn tiền / chờ thanh toán: loại.
    await mk('CANCELLED', 'UNPAID', [pepper(2)], { selfShip: true });
    await mk('RETURNED', 'PAID', [honey(1)], { selfShip: true });
    await mk('DELIVERED', 'REFUNDED', [pepper(3)], { selfShip: true });
    await mk('PENDING_PAYMENT', 'UNPAID', [pepper(1)], { selfShip: true });
    // Tự giao, trả một phần 1 Tiêu (hoàn 100k): 200k + 260k + 20k ship = 480k, còn 380k; 10 ngày trước.
    const x4 = await mk('DELIVERED', 'PAID', [pepper(2), honey(1)], { selfShip: true, shippingFee: 20_000, ageDays: 10 });
    await partialReturn(x4.order.id, x4.items[0].id, 1, 100_000);
    // Tự giao, trả hết dòng Trà: đơn vẫn tính, doanh thu 0, dòng Trà ẩn.
    const x6 = await mk('DELIVERED', 'PAID', [tea], { selfShip: true });
    await partialReturn(x6.order.id, x6.items[0].id, 1, 50_000);
    // Chính đại lý tự mua hàng mình qua slug mình: không phải doanh số gian hàng.
    await mk('DELIVERED', 'PAID', [pepper(9)], { selfShip: true, userId: dealer.id });
    // Gian hàng đại lý giao nhưng khách vào từ slug CTV khác: thuộc gian hàng kia.
    await mk('DELIVERED', 'PAID', [pepper(4)], { selfShip: true, slug: otherSlug });
    // CTV khác giới thiệu, Tubu giao, qua slug đại lý: như cũ, không phải đơn của đại lý.
    await mk('DELIVERED', 'PAID', [pepper(5)], { referrer: otherCtv.id });
    // Tự giao qua slug riêng, 40 ngày trước: ngoài cửa sổ 30 ngày, vẫn vào thống kê toàn thời gian (70k).
    await mk('DELIVERED', 'PAID', [{ productSlug: 'old', productName: 'Cũ', quantity: 1, total: 70_000 }], { selfShip: true, ageDays: 40 });
    return ctx;
  }

  it('getStats: đếm đơn tự giao qua slug riêng, không đếm đôi, dòng sản phẩm + phần cấp đơn cộng đúng ô Doanh thu', async () => {
    const { dealer, store } = await seedMixed();
    const commissionsBefore = await prisma.commission.count({ where: { order: { fulfillerStorefrontId: store.id } } });

    const s = await storefront.getStats(dealer.id);

    // 30 ngày: r1, x1, mixed, x4, x6. 7 ngày: x1, mixed, x6.
    expect(s.orders30d).toBe(5);
    expect(s.orders7d).toBe(3);
    // 800k + 225k + 260k + 380k + 0
    expect(s.revenue30d).toBe(1_665_000);
    expect(s.commission30d).toBe(78_000);
    expect(s.byProduct).toEqual([
      { productSlug: 'honey', productName: 'Mật ong', qty: 5, revenue: 1_300_000 },
      { productSlug: 'pepper', productName: 'Tiêu', qty: 3, revenue: 300_000 },
    ]);
    // r1 (30k − 10k) + x1 25k + x4 20k
    expect(s.shippingAndOrderDiscount30d).toBe(65_000);
    expect(s.byProduct.reduce((t, p) => t + p.revenue, 0) + s.shippingAndOrderDiscount30d).toBe(s.revenue30d);
    expect(await prisma.commission.count({ where: { order: { fulfillerStorefrontId: store.id } } })).toBe(commissionsBefore);
  });

  it('storefrontAnalytics: số đơn cùng bộ lọc trạng thái với doanh thu, gồm đơn tự giao qua slug riêng', async () => {
    const { dealer, slug } = await seedMixed();
    const row = (await affiliate.storefrontAnalytics(dealer.id)).storefronts.find((x) => x.slug === slug)!;
    // r1, x1, mixed, x4, x6, cũ 40 ngày
    expect(row).toEqual({ slug, title: 'Đại lý IT', orders: 6, revenue: 1_735_000, commission: 78_000 });
  });

  it('CTV thường: đơn huỷ/trả/hoàn tiền không vào số đơn của storefrontAnalytics', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const slug = `it-dlc-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({ data: { type: 'CTV', slug, ownerUserId: ctv.id, title: 'CTV IT', isPublished: true } });
    const mk = (status: OrderStatus, paymentStatus: PaymentStatus, total: number) =>
      createOrder(prisma, { userId: buyer.id, status, paymentStatus, total, referrerUserId: ctv.id, storefrontSlug: slug });
    await mk('DELIVERED', 'PAID', 300_000);
    await mk('CONFIRMED', 'UNPAID', 200_000);
    await mk('CANCELLED', 'UNPAID', 111_000);
    await mk('RETURNED', 'PAID', 222_000);
    await mk('PENDING_PAYMENT', 'UNPAID', 333_000);
    await mk('DELIVERED', 'REFUNDED', 444_000);
    await mk('DELIVERED', 'FAILED', 555_000);
    const row = (await affiliate.storefrontAnalytics(ctv.id)).storefronts.find((x) => x.slug === slug)!;
    expect(row).toMatchObject({ orders: 2, revenue: 500_000 });
  });

  it('đơn tự giao của gian hàng không phải CTV (MERCHANT) không vào thống kê CTV', async () => {
    const merchant = await createUser(prisma, { role: 'DEALER' });
    const buyer = await createUser(prisma);
    const slug = `it-dlm-${randCode(8).toLowerCase()}`;
    const st = await prisma.storefront.create({ data: { type: 'MERCHANT', slug, ownerUserId: merchant.id, title: 'NB IT', isPublished: true } });
    await createOrder(prisma, {
      userId: buyer.id, status: 'DELIVERED', paymentStatus: 'PAID', total: 90_000, storefrontSlug: slug, storefrontId: st.id,
      fulfiller: 'MERCHANT', fulfillerStorefrontId: st.id,
    });
    const row = (await affiliate.storefrontAnalytics(merchant.id)).storefronts.find((x) => x.slug === slug)!;
    expect(row).toMatchObject({ orders: 0, revenue: 0 });
  });
});
