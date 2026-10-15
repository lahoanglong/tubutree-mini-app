import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { GameService } from '../../src/modules/game/game.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { REAL_USER_REQUIRED_MSG } from '../../src/common/real-user';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * p6-promo-abuse: các lỗ khuyến mãi trên Postgres thật. CartService, CheckoutService, CouponsService, FlashSaleService,
 * GameService, LoyaltyService là bản thật; chỉ stub thông báo, Pancake, Gomdon, combo.
 */
describe('p6-promo-abuse: mã giảm giá, giờ vàng, nhiệm vụ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let coupons: CouponsService;
  let game: GameService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        FlashSaleService,
        PricingService,
        LoyaltyService,
        GameService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
        // FlashSaleService báo wishlist khi đợt giờ vàng mở (p9); không thuộc phạm vi spec này.
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    coupons = moduleRef.get(CouponsService);
    game = moduleRef.get(GameService);
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const realUser = () => createUser(prisma, { phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}` });
  const guestUser = () => createUser(prisma, { zaloId: `guest_${randCode(12)}` });

  async function product(price: number, stock = 50) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `p6-p-${tag}`, brand: 'IT', slug: `p6-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `p6-v-${tag}`, productId: p.id, sku: `P6-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock },
    });
    return { productId: p.id, variationId: v.id };
  }

  async function address(userId: string) {
    return prisma.address.create({
      data: {
        userId,
        recipient: 'Khach IT',
        phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
  }

  async function coupon(data: Partial<Parameters<PrismaService['coupon']['create']>[0]['data']> = {}) {
    const now = Date.now();
    return prisma.coupon.create({
      data: {
        code: `P6${randCode(8)}`,
        type: 'AMOUNT',
        value: 30_000,
        startAt: new Date(now - 3_600_000),
        endAt: new Date(now + 86_400_000),
        perUserLimit: 1,
        scope: 'PUBLIC',
        ...data,
      },
    });
  }

  async function flashItem(variationId: string, flashPrice: number, quota: number, perUserLimit: number) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    return prisma.flashSaleItem.create({ data: { flashSaleId: sale.id, variationId, flashPrice, quota, perUserLimit } });
  }

  it('MONEY-3: giỏ có hàng giờ vàng, phần còn lại dưới đơn tối thiểu của mã → đặt được đơn, KHÔNG tiêu lượt mã, couponCode null', async () => {
    const u = await realUser();
    const addr = await address(u.id);
    const flashP = await product(300_000);
    const regular = await product(100_000);
    await flashItem(flashP.variationId, 200_000, 10, 5);
    const c = await coupon({ minOrder: 250_000 });
    await cart.addItem(u.id, { variationId: flashP.variationId, quantity: 1 });
    await cart.addItem(u.id, { variationId: regular.variationId, quantity: 1 });
    await prisma.cart.update({ where: { userId: u.id }, data: { couponCode: c.code } });

    const quote = (await checkout.quote(u.id, { addressId: addr.id } as never)) as { couponApplied?: boolean; couponNotice?: string | null };
    expect(quote.couponApplied).toBe(false);
    expect(quote.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);

    const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.couponCode).toBeNull();
    expect(saved.discount).toBe(0);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(0);
  });

  it('MONEY-3: giỏ toàn hàng giờ vàng + mã riêng không có đơn tối thiểu (kiểu BIRTHDAY) → giảm 0đ, KHÔNG tiêu lượt mã', async () => {
    const u = await realUser();
    const addr = await address(u.id);
    const flashP = await product(300_000);
    await flashItem(flashP.variationId, 200_000, 10, 5);
    const c = await coupon({ scope: 'USER_GROUP', scopeMeta: { userId: u.id }, value: 50_000, minOrder: null });
    await cart.addItem(u.id, { variationId: flashP.variationId, quantity: 1 });
    await prisma.cart.update({ where: { userId: u.id }, data: { couponCode: c.code } });

    const view = await cart.getCart(u.id);
    expect(view.couponCode).toBe(c.code);
    expect(view.discount).toBe(0);
    expect(view.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);

    const quote = (await checkout.quote(u.id, { addressId: addr.id } as never)) as { discount: number; couponApplied?: boolean; couponNotice?: string | null };
    expect(quote.discount).toBe(0);
    expect(quote.couponApplied).toBe(false);
    expect(quote.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);

    const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.couponCode).toBeNull();
    expect(saved.discount).toBe(0);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    await expect(coupons.validateAndCompute(c.code, u.id, 100_000)).resolves.toMatchObject({ discount: 50_000 });
  });

  it('ENGAGE-4: khách đã mua hết giới hạn/khách → giỏ tính giá thường, đặt đơn được, không tiêu suất flash', async () => {
    const u = await realUser();
    const addr = await address(u.id);
    const p = await product(260_000);
    const item = await flashItem(p.variationId, 200_000, 5, 1);
    await prisma.flashSaleItem.update({ where: { id: item.id }, data: { soldCount: 1 } });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: item.id, userId: u.id, quantity: 1 } });
    await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });

    const c = await cart.getCart(u.id);
    expect(c.items[0]).toMatchObject({ unitPrice: 260_000, isFlash: false, flashSaleItemId: null });
    expect(c.items[0]!.flashLimitNotice).toBe('Bạn đã dùng hết suất giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.');

    const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).subtotal).toBe(260_000);
    expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(1);
  });

  it('ENGAGE-4: 4 khách cùng đặt 1 suất giờ vàng còn 2 → đúng 2 đơn giá flash, soldCount không vượt quota', async () => {
    const p = await product(260_000);
    const item = await flashItem(p.variationId, 200_000, 2, 1);
    const buyers = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const u = await realUser();
        const addr = await address(u.id);
        await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
        return { u, addr };
      }),
    );
    const results = await Promise.allSettled(
      buyers.map(({ u, addr }) => checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)),
    );
    const s = summarize(results);
    console.log('[ENGAGE-4] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.soldCount).toBeLessThanOrEqual(2);
    const flashOrders = await prisma.orderItem.count({ where: { variationId: p.variationId, flashSaleItemId: item.id } });
    expect(flashOrders).toBe(after.soldCount);
  });

  it('MONEY-1/12: mã công khai giới hạn/khách từ chối tài khoản khách; tài khoản thật dùng được', async () => {
    const c = await coupon({ minOrder: 0 });
    const guest = await guestUser();
    await expect(coupons.validateAndCompute(c.code, guest.id, 100_000)).rejects.toThrow(REAL_USER_REQUIRED_MSG);
    const real = await realUser();
    await expect(coupons.validateAndCompute(c.code, real.id, 100_000)).resolves.toMatchObject({ discount: 30_000 });
  });

  it('mã gõ thường/khoảng trắng được chuẩn hoá: áp vào giỏ, đặt đơn ghi đúng 1 lượt dùng', async () => {
    const u = await realUser();
    const addr = await address(u.id);
    const p = await product(300_000);
    const c = await coupon({ minOrder: 0 });
    await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
    await cart.applyCoupon(u.id, ` ${c.code.toLowerCase()} `);
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId: u.id } })).couponCode).toBe(c.code);
    const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).couponCode).toBe(c.code);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
  });

  it('MONEY-4: mã mua chung gắn sản phẩm chỉ áp khi giỏ có đúng sản phẩm đó, giảm tính trên dòng đó', async () => {
    const u = await realUser();
    const target = await product(80_000);
    const other = await product(500_000);
    const c = await coupon({ scope: 'USER_GROUP', scopeMeta: { userId: u.id }, value: 30_000, minOrder: 50_000, applyTo: { productIds: [target.productId] } });
    await expect(
      coupons.validateAndCompute(c.code, u.id, 500_000, [{ productId: other.productId, total: 500_000 }]),
    ).rejects.toThrow('Mã này chỉ áp dụng khi mua đúng sản phẩm của chương trình. Giỏ hàng chưa có sản phẩm đó.');
    await expect(
      coupons.validateAndCompute(c.code, u.id, 580_000, [
        { productId: other.productId, total: 500_000 },
        { productId: target.productId, total: 80_000 },
      ]),
    ).resolves.toMatchObject({ discount: 30_000 });
  });

  describe('ENGAGE-1/11: nhiệm vụ', () => {
    beforeAll(async () => {
      for (const m of [
        { id: 'p6-first', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: 'IT', rewardPoints: 20, goal: 1, isRepeatable: false },
        { id: 'p6-invite', code: 'INVITE_3', title: 'Lan tỏa', description: 'IT', rewardPoints: 50, goal: 3, isRepeatable: false },
      ]) {
        const { id: _id, ...rest } = m;
        await prisma.mission.upsert({ where: { code: m.code }, update: rest, create: m });
      }
    });

    it('INVITE_3: 3 tài khoản khách được mời nhưng chưa mua → không nhận được 50 điểm', async () => {
      const referrer = await realUser();
      for (let i = 0; i < 3; i++) await createUser(prisma, { zaloId: `guest_${randCode(12)}`, referredById: referrer.id });
      await expect(game.claimMission(referrer.id, 'INVITE_3')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } })).pointsBalance).toBe(0);
    });

    it('FIRST_ORDER: đơn mới CONFIRMED chưa tính; đơn DELIVERED → 5 lần nhận song song chỉ cộng 20 điểm một lần', async () => {
      const u = await realUser();
      const pending = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED' });
      await expect(game.claimMission(u.id, 'FIRST_ORDER')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
      await prisma.order.update({ where: { id: pending.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => game.claimMission(u.id, 'FIRST_ORDER')));
      const s = summarize(results);
      expect(s.fulfilled).toHaveLength(1);
      for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(20);
      expect(await prisma.pointsTransaction.count({ where: { userId: u.id, reason: { startsWith: 'MISSION:FIRST_ORDER' } } })).toBe(1);
    });

    it('ENGAGE-11: nhiệm vụ không lặp lại đã nhận ở chu kỳ cũ (dữ liệu khi còn lặp) → không nhận thêm', async () => {
      const u = await realUser();
      await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date() });
      const mission = await prisma.mission.findUniqueOrThrow({ where: { code: 'FIRST_ORDER' } });
      await prisma.missionProgress.create({
        data: { userId: u.id, missionId: mission.id, cycleKey: '1', progress: 1, goal: 1, completedAt: new Date() },
      });
      await expect(game.claimMission(u.id, 'FIRST_ORDER')).rejects.toThrow('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    });
  });
});
