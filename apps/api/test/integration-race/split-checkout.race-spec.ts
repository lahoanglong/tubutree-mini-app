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
import { createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Đặt đơn tách theo nơi giao (D4) chạy chồng nhau trên Postgres thật: cùng Idempotency-Key bấm nhiều lần thì chỉ một lần đặt
 * (một nhóm đơn Tubu + đối tác), mỗi biến thể chỉ bị trừ kho một lần, tiền các đơn con cộng lại khớp đúng một lần thanh toán.
 * CheckoutService, CartService, PricingService là bản thật; stub thông báo / Pancake / Gomdon / combo / flash-sale / coupon.
 */
describe('Checkout tách đơn theo nơi giao dưới tải song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;

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
        {
          provide: CouponsService,
          useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: { notify: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PancakeOrderService,
          useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: GomdonOrderService,
          useValue: {
            isRecyclingEnabled: jest.fn().mockResolvedValue(false),
            enqueuePush: jest.fn(),
          },
        },
        {
          provide: ComboService,
          useValue: {
            computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }),
          },
        },
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

    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

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

  async function variation(data: {
    storefrontId?: string;
    fulfilment: 'TUBU' | 'MERCHANT';
    price: number;
  }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: data.fulfilment === 'TUBU' ? `itsc-p-${tag}` : null,
        storefrontId: data.storefrontId ?? null,
        fulfilment: data.fulfilment,
        brand: 'IT',
        slug: `itsc-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: data.price,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: data.fulfilment === 'TUBU' ? `itsc-v-${tag}` : null,
        productId: product.id,
        sku: `ITSC-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: data.price,
        stock: 20,
      },
    });
  }

  it('4 lần đặt cùng Idempotency-Key, giỏ có hàng Tubu + hàng đối tác → đúng 1 nhóm 2 đơn, kho trừ 1 lần, mọi lần trả cùng nhóm', async () => {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: {
        type: 'MERCHANT',
        slug: `itsc-${tag}`,
        title: `Shop ${tag}`,
        ownerUserId: owner.id,
        isPublished: true,
      },
    });
    const tubu = await variation({ fulfilment: 'TUBU', price: 120_000 });
    const shop = await variation({ fulfilment: 'MERCHANT', storefrontId: store.id, price: 80_000 });
    const u = await createUser(prisma);
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
    await cart.addItem(u.id, { variationId: tubu.id, quantity: 2 });
    await cart.addItem(u.id, { variationId: shop.id, quantity: 1 });
    const key = `itsc-${randCode(12)}`;

    const spy = barrierOnGetCart(4);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never, key),
        ),
      );
    } finally {
      spy.mockRestore();
    }
    const s = summarize(results);
    const orders = await prisma.order.findMany({
      where: { userId: u.id },
      include: { items: true },
      orderBy: { fulfiller: 'asc' },
    });
    const stocks = await prisma.variation.findMany({
      where: { id: { in: [tubu.id, shop.id] } },
      select: { id: true, stock: true },
    });
    console.log(
      '[split] fulfilled=%d rejected=%d orders=%d errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      orders.length,
      s.errors,
    );

    expect(s.fulfilled).toHaveLength(4);
    expect(orders).toHaveLength(2);
    const [tubuOrder, shopOrder] = orders;
    expect(tubuOrder!.fulfiller).toBe('TUBU');
    expect(shopOrder!.fulfiller).toBe('MERCHANT');
    expect(shopOrder!.fulfillerStorefrontId).toBe(store.id);
    expect(new Set(orders.map((o) => o.checkoutGroup))).toEqual(new Set([tubuOrder!.code]));
    expect(tubuOrder!.idempotencyKey).toBe(key);
    expect(shopOrder!.idempotencyKey).toBeNull();
    const returned = new Set(s.fulfilled.map((r) => (r.value as { id: string }).id));
    expect(returned).toEqual(new Set([tubuOrder!.id]));

    expect(tubuOrder!.items.map((i) => [i.variationId, i.quantity])).toEqual([[tubu.id, 2]]);
    expect(shopOrder!.items.map((i) => [i.variationId, i.quantity])).toEqual([[shop.id, 1]]);
    expect(Object.fromEntries(stocks.map((v) => [v.id, v.stock]))).toEqual({
      [tubu.id]: 18,
      [shop.id]: 19,
    });
    for (const o of orders) {
      expect(o.subtotal).toBe(o.items.reduce((t, i) => t + i.total, 0));
      expect(o.total).toBe(o.subtotal + o.shippingFee - o.discount);
    }
    expect(shopOrder!.shippingFee).toBe(25_000);
  });
});
