import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R2-MONEY-2: khách bấm "Đặt hàng" lại với Idempotency-Key KHÁC trong lúc lần đầu còn chạy (app báo quá thời gian) hoặc
 * ngay sau khi lần đầu đã xong. Giỏ là một lần đặt: chỉ được ra một đơn, một lần trừ Ví, một lần trừ kho, và lần bấm sau
 * nhận lại chính đơn vừa tạo thay vì lỗi.
 */
describe('Đặt đơn trùng khác Idempotency-Key (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  const pancakePush = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn() } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: pancakePush } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        {
          provide: FlashSaleService,
          useValue: {
            resolveEffective: jest.fn().mockResolvedValue(new Map()),
            consumeQuota: jest.fn(),
            restore: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Mọi lần đặt đều đọc xong giỏ (compute) rồi mới cùng đi tiếp — dựng đúng ca "lần đầu chưa xong thì bấm lại". */
  function barrierOnGetCart(n: number) {
    const original = cart.getCart.bind(cart);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return jest.spyOn(cart, 'getCart').mockImplementation(async (userId: string) => {
      const res = await original(userId);
      if (++arrived === n) release();
      await gate;
      return res;
    });
  }

  async function buyerWithCart(walletBalance: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `itdup-p-${tag}`,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itdup-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itdup-v-${tag}`,
        productId: product.id,
        sku: `ITDUP-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock: 20,
      },
    });
    const u = await createUser(prisma, { walletBalance });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
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
    await cart.addItem(u.id, { variationId: v.id, quantity: 2 });
    return { u, addr, v };
  }

  it('2 lần đặt WALLET chạy chồng, mỗi lần một key → đúng 1 đơn, ví trừ 1 lần, kho trừ 1 lần, cả 2 lần trả cùng đơn', async () => {
    const { u, addr, v } = await buyerWithCart(1_000_000);
    pancakePush.mockClear();

    const spy = barrierOnGetCart(2);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        ['itdup-a', 'itdup-b'].map((k) =>
          checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'WALLET' } as never, `${k}-${randCode(10)}`),
        ),
      );
    } finally {
      spy.mockRestore();
    }
    const s = summarize(results);
    const orders = await prisma.order.findMany({ where: { userId: u.id } });
    const debits = await prisma.walletTransaction.findMany({ where: { userId: u.id, type: 'ORDER_PAY' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const stock = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    console.log('[dup] fulfilled=%d rejected=%d orders=%d errors=%j', s.fulfilled.length, s.rejected.length, orders.length, s.errors);

    expect(orders).toHaveLength(1);
    expect(debits).toHaveLength(1);
    expect(user.walletBalance).toBe(1_000_000 - orders[0]!.total);
    expect(stock.stock).toBe(18);
    expect(s.fulfilled).toHaveLength(2);
    expect(new Set(s.fulfilled.map((r) => (r.value as { id: string }).id))).toEqual(new Set([orders[0]!.id]));
    expect(pancakePush).toHaveBeenCalledTimes(1);
    expect(await prisma.cartItem.count({ where: { cart: { userId: u.id } } })).toBe(0);
  });

  it('giỏ tách Tubu + gian hàng, 3 lần đặt chồng mỗi lần một key → đúng 1 nhóm 2 đơn, mọi lần trả đơn đầu nhóm', async () => {
    const { u, addr } = await buyerWithCart(0);
    // Chủ gian hàng phải còn quyền bán (DEALER): chủ là CUSTOMER thì gian hàng tính là đã đóng (STORE_CLOSED), không nhận đơn.
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itdup-${tag}`, title: `Shop ${tag}`, ownerUserId: owner.id, isPublished: true },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itdup-m-${tag}`,
        name: `SP shop ${tag}`,
        description: 'IT',
        basePrice: 50_000,
      },
    });
    const shopVar = await prisma.variation.create({
      data: { productId: product.id, sku: `ITDUPM-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 50_000, stock: 5 },
    });
    await cart.addItem(u.id, { variationId: shopVar.id, quantity: 1 });

    const spy = barrierOnGetCart(3);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        [1, 2, 3].map((n) =>
          checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never, `itdup-s${n}-${randCode(10)}`),
        ),
      );
    } finally {
      spy.mockRestore();
    }
    const s = summarize(results);
    const orders = await prisma.order.findMany({ where: { userId: u.id }, orderBy: { fulfiller: 'asc' } });
    expect(orders).toHaveLength(2);
    expect(s.fulfilled).toHaveLength(3);
    const primary = orders.find((o) => o.code === o.checkoutGroup)!;
    expect(new Set(s.fulfilled.map((r) => (r.value as { id: string }).id))).toEqual(new Set([primary.id]));
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: shopVar.id } })).stock).toBe(4);
    const split = (s.fulfilled[0]!.value as { splitOrders: { pointsEarned: number }[] }).splitOrders;
    expect(split.reduce((t, o) => t + o.pointsEarned, 0)).toBe(orders.reduce((t, o) => t + o.pointsEarned, 0));
  });

  it('bấm lại với key mới ngay sau khi lần đầu đã xong → nhận lại đơn vừa tạo, không báo lỗi giỏ trống', async () => {
    const { u, addr } = await buyerWithCart(0);
    const first = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never, `itdup-c-${randCode(10)}`);
    const again = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never, `itdup-d-${randCode(10)}`);
    expect(again.id).toBe(first.id);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(1);
  });

  it('bấm lại với thông tin khác (đổi cách trả tiền) sau khi đơn đã tạo → không trả nhầm đơn cũ', async () => {
    const { u, addr } = await buyerWithCart(1_000_000);
    await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never, `itdup-e-${randCode(10)}`);
    await expect(
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'WALLET' } as never, `itdup-f-${randCode(10)}`),
    ).rejects.toThrow('Chưa chọn sản phẩm');
    expect(await prisma.walletTransaction.count({ where: { userId: u.id } })).toBe(0);
  });
});
