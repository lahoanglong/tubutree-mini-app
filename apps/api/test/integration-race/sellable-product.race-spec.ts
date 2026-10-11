import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ProductApprovalStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { PRODUCT_DISCONTINUED } from '../../src/modules/cart/sellable';
import * as orderCode from '../../src/common/order-code';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-007 / A5N-04 (Q-14, docs/2026-10-review): SP ngừng bán (variation/Product isActive=false) hoặc SP
 * đối tác chưa duyệt / bị từ chối KHÔNG được tạo đơn ở cả 4 đường — giỏ/checkout, CTV lên đơn hộ, đại
 * lý, gói định kỳ — kể cả khi SP bị gỡ ĐÚNG LÚC đơn đang được tính (giữa lúc đọc giá và lúc ghi đơn).
 * Postgres thật; chỉ stub dịch vụ ngoài (Pancake/Gomdon/thông báo) và các khối giá không liên quan.
 */
/** Gói hẹn ngày bắt đầu sau hôm nay: không sinh đơn đầu ngay (C-015), giữ đúng phạm vi các ca dưới đây. */
const LATER = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);

describe('SP ngừng bán không đặt được ở mọi đường (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cart: CartService;
  let checkout: CheckoutService;
  let affiliate: AffiliateService;
  let dealer: DealerService;
  let subs: SubscriptionsService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const pricing = {
    calcShippingFee: jest.fn().mockResolvedValue(0),
    calcTierDiscount: jest.fn().mockReturnValue(0),
    resolvePointsRedemption: jest.fn().mockResolvedValue({ pointsUsed: 0, discount: 0 }),
    calcPointsEarned: jest.fn().mockResolvedValue(0),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        AffiliateService,
        CoinsService,
        DealerService,
        SubscriptionsService,
        WalletLedgerService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn() } },
        { provide: PricingService, useValue: pricing },
        {
          provide: LoyaltyService,
          useValue: {
            lockedOrderPoints: jest.fn().mockResolvedValue({ locked: 0 }),
            getTierMultiplier: jest.fn().mockResolvedValue(1),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        {
          provide: FlashSaleService,
          useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()), consumeQuota: jest.fn() },
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    cart = moduleRef.get(CartService);
    checkout = moduleRef.get(CheckoutService);
    affiliate = moduleRef.get(AffiliateService);
    dealer = moduleRef.get(DealerService);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    notify.mockClear();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function variation(over: { stock?: number; approvalStatus?: ProductApprovalStatus } = {}) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        approvalStatus: over.approvalStatus ?? 'APPROVED',
      },
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
        stock: over.stock ?? 50,
      },
      include: { product: true },
    });
  }

  /** Ba cách một SP thôi được bán — test chạy lần lượt qua cả ba. */
  const DISCONTINUE = {
    'Product.isActive=false': (productId: string) =>
      prisma.product.update({ where: { id: productId }, data: { isActive: false } }),
    'Product REJECTED': (productId: string) =>
      prisma.product.update({ where: { id: productId }, data: { approvalStatus: 'REJECTED' } }),
    'Variation.isActive=false': (productId: string) =>
      prisma.variation.updateMany({ where: { productId }, data: { isActive: false } }),
  } as const;

  async function address(userId: string) {
    return prisma.address.create({
      data: {
        userId,
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '01',
        districtCode: '',
        wardCode: '00001',
      },
    });
  }

  const customer = () => ({
    recipient: 'Khach IT',
    phone: randomPhone(),
    province: 'Ha Noi',
    ward: 'Phuong IT',
    street: '1 Duong IT',
    provinceCode: '01',
    wardCode: '00001',
  });

  async function stockOf(variationId: string) {
    return (await prisma.variation.findUniqueOrThrow({ where: { id: variationId } })).stock;
  }

  function expectDiscontinued(err: unknown) {
    const res = (err as { getResponse?: () => unknown }).getResponse?.() as { code?: string; message?: string };
    expect(res?.code).toBe(PRODUCT_DISCONTINUED);
    expect(res?.message).toMatch(/ngừng bán/);
  }

  // ── Giỏ / checkout ───────────────────────────────────

  describe.each(Object.keys(DISCONTINUE) as (keyof typeof DISCONTINUE)[])('giỏ/checkout — %s', (how) => {
    it('getCart loại dòng ngừng bán ra khỏi items/subtotal và trả unavailableItems cho FE', async () => {
      const u = await createUser(prisma);
      const ok = await variation();
      const gone = await variation();
      await cart.addItem(u.id, { variationId: ok.id, quantity: 1 });
      await cart.addItem(u.id, { variationId: gone.id, quantity: 2 });
      await DISCONTINUE[how](gone.productId);

      const c = await cart.getCart(u.id);
      expect(c.items.map((l) => l.variationId)).toEqual([ok.id]);
      expect(c.subtotal).toBe(100_000);
      expect(c.itemCount).toBe(1);
      expect(c.unavailableItems).toEqual([
        expect.objectContaining({ variationId: gone.id, productName: gone.product.name, quantity: 2 }),
      ]);
    });

    it('đặt toàn giỏ: đơn chỉ gồm dòng còn bán, kho SP ngừng bán không bị trừ', async () => {
      const u = await createUser(prisma);
      const addr = await address(u.id);
      const ok = await variation();
      const gone = await variation();
      await cart.addItem(u.id, { variationId: ok.id, quantity: 1 });
      await cart.addItem(u.id, { variationId: gone.id, quantity: 2 });
      await DISCONTINUE[how](gone.productId);

      const order = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never);
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      expect(items.map((i) => i.variationId)).toEqual([ok.id]);
      expect(await stockOf(gone.id)).toBe(50);
    });

    it('mua ngay (itemIds) đúng dòng ngừng bán → 400 PRODUCT_DISCONTINUED, không đơn, không trừ kho', async () => {
      const u = await createUser(prisma);
      const addr = await address(u.id);
      const gone = await variation();
      await cart.addItem(u.id, { variationId: gone.id, quantity: 1 });
      const line = await prisma.cartItem.findFirstOrThrow({ where: { variationId: gone.id } });
      await DISCONTINUE[how](gone.productId);

      const err = await checkout
        .placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', itemIds: [line.id] } as never)
        .catch((e) => e);
      expectDiscontinued(err);
      await expect(
        checkout.quote(u.id, { addressId: addr.id, itemIds: [line.id] } as never),
      ).rejects.toMatchObject({ response: { code: PRODUCT_DISCONTINUED } });
      expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
      expect(await stockOf(gone.id)).toBe(50);
    });
  });

  it('checkout: SP bị gỡ SAU khi đã tính giá nhưng TRƯỚC khi ghi đơn → kiểm lại trong tx chặn đơn', async () => {
    const u = await createUser(prisma);
    const addr = await address(u.id);
    const v = await variation();
    await cart.addItem(u.id, { variationId: v.id, quantity: 3 });
    // Gỡ SP ngay sau bước tính phí ship (đã qua getCart/compute, chưa vào transaction ghi đơn).
    pricing.calcShippingFee.mockImplementationOnce(async () => {
      await prisma.product.update({ where: { id: v.productId }, data: { approvalStatus: 'REJECTED' } });
      return 0;
    });

    const err = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never).catch((e) => e);
    expectDiscontinued(err);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await stockOf(v.id)).toBe(50);
  });

  it('checkout: 6 khách đặt song song trong lúc admin gỡ SP → mọi đơn tạo ra đều trước lúc gỡ, kho khớp số đơn', async () => {
    const v = await variation({ stock: 100 });
    const buyers = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const u = await createUser(prisma);
        const addr = await address(u.id);
        await cart.addItem(u.id, { variationId: v.id, quantity: 1 });
        return { u, addr };
      }),
    );
    const results = await Promise.allSettled([
      ...buyers.map(({ u, addr }) => checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)),
      prisma.product.update({ where: { id: v.productId }, data: { isActive: false } }),
    ]);
    const s = summarize(results);
    const orders = await prisma.orderItem.count({ where: { variationId: v.id } });
    console.log('[c007 checkout x6 + gỡ] fulfilled=%d rejected=%d orders=%d errors=%j', s.fulfilled.length, s.rejected.length, orders, [...new Set(s.errors)]);
    for (const r of s.rejected) expectDiscontinued(r.reason);
    expect(await stockOf(v.id)).toBe(100 - orders);

    // Sau khi gỡ đã commit: không ai đặt được nữa.
    const late = await createUser(prisma);
    const lateAddr = await address(late.id);
    await prisma.cartItem.create({
      data: { cart: { create: { userId: late.id } }, variation: { connect: { id: v.id } }, quantity: 1 },
    });
    const err = await checkout.placeOrder(late.id, { addressId: lateAddr.id, paymentMethod: 'COD' } as never).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await prisma.order.count({ where: { userId: late.id } })).toBe(0);
  });

  // ── CTV lên đơn hộ ───────────────────────────────────

  describe.each(Object.keys(DISCONTINUE) as (keyof typeof DISCONTINUE)[])('CTV lên đơn hộ — %s', (how) => {
    it('SP ngừng bán → 400 PRODUCT_DISCONTINUED, không đơn, không trừ kho', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation();
      await DISCONTINUE[how](v.productId);
      const err = await affiliate
        .placeOrderForCustomer(ctv.id, {
          items: [{ variationId: v.id, quantity: 1 }],
          customer: customer(),
          paymentMethod: 'COD',
        } as never)
        .catch((e) => e);
      expectDiscontinued(err);
      expect(await prisma.order.count({ where: { userId: ctv.id } })).toBe(0);
      expect(await stockOf(v.id)).toBe(50);
    });
  });

  it('CTV lên đơn hộ: SP đối tác đang CHỜ DUYỆT (isActive vẫn true) → chặn', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await variation({ approvalStatus: 'PENDING_REVIEW' });
    const err = await affiliate
      .placeOrderForCustomer(ctv.id, {
        items: [{ variationId: v.id, quantity: 1 }],
        customer: customer(),
        paymentMethod: 'COD',
      } as never)
      .catch((e) => e);
    expectDiscontinued(err);
  });

  it('CTV lên đơn hộ: SP bị gỡ giữa lúc tính giá và lúc ghi đơn → kiểm lại trong tx chặn', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await variation();
    pricing.calcShippingFee.mockImplementationOnce(async () => {
      await prisma.product.update({ where: { id: v.productId }, data: { isActive: false } });
      return 0;
    });
    const err = await affiliate
      .placeOrderForCustomer(ctv.id, {
        items: [{ variationId: v.id, quantity: 1 }],
        customer: customer(),
        paymentMethod: 'COD',
      } as never)
      .catch((e) => e);
    expectDiscontinued(err);
    expect(await prisma.order.count({ where: { userId: ctv.id } })).toBe(0);
    expect(await stockOf(v.id)).toBe(50);
  });

  // ── Đại lý ───────────────────────────────────────────

  describe.each(Object.keys(DISCONTINUE) as (keyof typeof DISCONTINUE)[])('đại lý — %s', (how) => {
    it('SP ngừng bán → 400 PRODUCT_DISCONTINUED, không đơn, không trừ kho, không ghi công nợ', async () => {
      const d = await createUser(prisma, { role: 'DEALER' });
      const v = await variation();
      await DISCONTINUE[how](v.productId);
      const err = await dealer
        .placeOrder(d.id, { items: [{ variationId: v.id, quantity: 1 }], paymentMethod: 'BANK_TRANSFER' } as never)
        .catch((e) => e);
      expectDiscontinued(err);
      expect(await prisma.order.count({ where: { userId: d.id } })).toBe(0);
      expect(await stockOf(v.id)).toBe(50);
    });
  });

  it('đại lý: SP bị gỡ giữa lúc tính giá và lúc ghi đơn → kiểm lại trong tx chặn', async () => {
    const d = await createUser(prisma, { role: 'DEALER' });
    const v = await variation();
    // Sinh mã đơn chạy sau khi dựng dòng/giá, trước transaction ghi đơn.
    const original = orderCode.generateUniqueOrderCode;
    jest.spyOn(orderCode, 'generateUniqueOrderCode').mockImplementationOnce(async (...args) => {
      await prisma.product.update({ where: { id: v.productId }, data: { approvalStatus: 'REJECTED' } });
      return original(...args);
    });
    const err = await dealer
      .placeOrder(d.id, { items: [{ variationId: v.id, quantity: 1 }], paymentMethod: 'BANK_TRANSFER' } as never)
      .catch((e) => e);
    expectDiscontinued(err);
    expect(await prisma.order.count({ where: { userId: d.id } })).toBe(0);
    expect(await stockOf(v.id)).toBe(50);
  });

  // ── Gói định kỳ ──────────────────────────────────────

  describe.each(Object.keys(DISCONTINUE) as (keyof typeof DISCONTINUE)[])('gói định kỳ — %s', (how) => {
    it('tạo gói cho SP ngừng bán → 400 PRODUCT_DISCONTINUED, không có gói', async () => {
      const u = await createUser(prisma);
      const addr = await address(u.id);
      const v = await variation();
      await DISCONTINUE[how](v.productId);
      const err = await subs
        .create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER })
        .catch((e) => e);
      expectDiscontinued(err);
      expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(0);
    });

    it('đến kỳ mà SP đã ngừng bán → gói PAUSED + báo khách, không sinh đơn, không trừ kho', async () => {
      const u = await createUser(prisma);
      const addr = await address(u.id);
      const v = await variation();
      const sub = await subs.create(u.id, { variationId: v.id, quantity: 2, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
      await prisma.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
      await DISCONTINUE[how](v.productId);

      await subs.processDue();
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(after.status).toBe('PAUSED');
      expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(0);
      expect(await stockOf(v.id)).toBe(50);
      expect(notify).toHaveBeenCalledWith(u.id, 'SUBSCRIPTION_PAUSED', expect.anything());
    });
  });

  it('gói định kỳ: SP bị gỡ giữa lúc tính giá kỳ và lúc ghi đơn → không sinh đơn, gói PAUSED', async () => {
    const u = await createUser(prisma);
    const addr = await address(u.id);
    const v = await variation();
    const sub = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
    await prisma.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    pricing.calcShippingFee.mockImplementationOnce(async () => {
      await prisma.product.update({ where: { id: v.productId }, data: { approvalStatus: 'REJECTED' } });
      return 0;
    });

    await subs.processDue();
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PAUSED');
    expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(0);
    expect(await stockOf(v.id)).toBe(50);
  });
});
