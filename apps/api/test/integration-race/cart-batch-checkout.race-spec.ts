import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService, CART_CHANGED } from '../../src/modules/checkout/checkout.service';
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
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { createUser, deleteItData, randCode, setConfig, warmPool } from './helpers';

/**
 * "Thêm cả combo" (CartService.addItemsBatch) xen với lúc đặt đơn của cùng khách, Postgres thật: batch lấy cùng khoá dòng `carts`
 * với lockForCheckout. Giỏ = báo giá = đơn: món khách đã thấy lúc đặt không đổi số lượng sau lưng họ (CART_CHANGED), món mới vào
 * giỏ không bị đặt thay hay bị xoá mất, và không món nào bị mất hay đếm hai lần giữa đơn và giỏ.
 */
describe('Batch thêm giỏ xen với đặt đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const PRICE = 50_000;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        ComboService,
        FlashSaleService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        { provide: LifecycleService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await moduleRef?.close();
  });

  async function product(stock = 50) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itcbc-p-${tag}`, brand: 'IT', slug: `itcbc-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE,
        variations: { create: { pancakeId: `itcbc-v-${tag}`, sku: `ITCBC-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: PRICE, stock } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return { productId: p.id, variationId: p.variations[0]!.id, stock };
  }

  async function buyer() {
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const u = await createUser(prisma, { phone, zaloId: `z-${randCode(10)}` });
    userIds.push(u.id);
    const addr = await prisma.address.create({
      data: {
        userId: u.id, recipient: 'Khach IT', phone, province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '1 Duong IT',
        provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    return { userId: u.id, addressId: addr.id };
  }

  const place = (b: { userId: string; addressId: string }) =>
    checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD' } as never, `itcbc-${randCode(12)}`);

  const cartQty = async (userId: string) =>
    new Map((await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { variationId: true, quantity: true } })).map((l) => [l.variationId, l.quantity]));
  const orders = (userId: string) => prisma.order.findMany({ where: { userId }, include: { items: true } });
  const orderQty = async (userId: string) => {
    const out = new Map<string, number>();
    for (const o of await orders(userId)) for (const it of o.items) out.set(it.variationId, (out.get(it.variationId) ?? 0) + it.quantity);
    return out;
  };
  const stockOf = async (variationId: string) => (await prisma.variation.findUniqueOrThrow({ where: { id: variationId } })).stock;

  /** Chạy `mutate` ngay sau khi lần đặt đơn đã đọc giỏ và trước khi nó khoá giỏ: khe mà batch xen vào. */
  async function duringCheckoutRead<T>(mutate: () => Promise<unknown>, run: () => Promise<T>) {
    const original = cart.getCartForCheckout.bind(cart);
    const spy = jest.spyOn(cart, 'getCartForCheckout').mockImplementationOnce(async (uid: string) => {
      const read = await original(uid);
      await mutate();
      return read;
    });
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it('batch cộng thêm vào dòng khách đang đặt, rơi vào khe giữa lúc đọc giỏ và khoá giỏ: CART_CHANGED, không có đơn, không giữ kho, mọi thay đổi của batch còn trong giỏ', async () => {
    const b = await buyer();
    const a = await product();
    const c = await product();
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 2 });
    const err = await duringCheckoutRead(
      () => cart.addItemsBatch(b.userId, [{ variationId: a.variationId, quantity: 1 }, { variationId: c.variationId, quantity: 1 }], 'ctv_sheet'),
      () => place(b).catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: CART_CHANGED });
    expect(await orders(b.userId)).toHaveLength(0);
    expect(await stockOf(a.variationId)).toBe(a.stock);
    expect(await cartQty(b.userId)).toEqual(new Map([[a.variationId, 3], [c.variationId, 1]]));
  });

  it('batch chỉ thêm món MỚI trong khe đó: đơn vẫn đặt đúng phần khách đã thấy (tiền hàng = số lượng đã đọc × giá), món mới còn nguyên trong giỏ', async () => {
    const b = await buyer();
    const a = await product();
    const c = await product();
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 2 });
    await duringCheckoutRead(
      () => cart.addItemsBatch(b.userId, [{ variationId: c.variationId, quantity: 3 }], 'pdp'),
      () => place(b),
    );
    const placed = await orders(b.userId);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.items.map((i) => [i.variationId, i.quantity])).toEqual([[a.variationId, 2]]);
    expect(placed[0]!.subtotal).toBe(2 * PRICE);
    expect(await stockOf(a.variationId)).toBe(a.stock - 2);
    expect(await stockOf(c.variationId)).toBe(c.stock);
    expect(await cartQty(b.userId)).toEqual(new Map([[c.variationId, 3]]));
  });

  it('chạy song song thật 6 lần (batch +1 dòng đang có và thêm món mới, cùng lúc đặt đơn): mọi thứ tự đều bảo toàn số lượng giữa đơn và giỏ, tiền hàng đơn khớp các dòng của nó', async () => {
    const seen = { placed: 0, changed: 0 };
    for (let i = 0; i < 6; i++) {
      const b = await buyer();
      const a = await product();
      const c = await product();
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 2 });
      const [placed, batch] = await Promise.allSettled([
        place(b),
        cart.addItemsBatch(b.userId, [{ variationId: a.variationId, quantity: 1 }, { variationId: c.variationId, quantity: 1 }], 'ctv_sheet'),
      ]);
      expect(batch.status).toBe('fulfilled');
      if (placed.status === 'rejected') {
        expect(placed.reason).toBeInstanceOf(BadRequestException);
        expect((placed.reason as BadRequestException).getResponse()).toMatchObject({ code: CART_CHANGED });
        seen.changed += 1;
      } else {
        seen.placed += 1;
      }
      const inOrder = await orderQty(b.userId);
      const inCart = await cartQty(b.userId);
      // Không mất, không đếm hai lần: khách có 2 + 1 cái a và 1 cái c, mỗi cái ở đúng một nơi (đơn hoặc giỏ).
      expect((inOrder.get(a.variationId) ?? 0) + (inCart.get(a.variationId) ?? 0)).toBe(3);
      expect((inOrder.get(c.variationId) ?? 0) + (inCart.get(c.variationId) ?? 0)).toBe(1);
      for (const o of await orders(b.userId)) expect(o.subtotal).toBe(o.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0));
      expect(await stockOf(a.variationId)).toBe(a.stock - (inOrder.get(a.variationId) ?? 0));
      expect(await stockOf(c.variationId)).toBe(c.stock - (inOrder.get(c.variationId) ?? 0));
    }
    expect(seen.placed + seen.changed).toBe(6);
  });
});
