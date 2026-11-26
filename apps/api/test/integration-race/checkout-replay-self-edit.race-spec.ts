import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
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
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderCustomerEditService } from '../../src/modules/orders/order-customer-edit.service';
import { ORDER_CUSTOMER_SELF_EDIT_KEY } from '../../src/modules/orders/order-customer-edit';
import { createUser, deleteItData, pinConfig, randCode, setConfig, warmPool } from './helpers';

/**
 * Đặt đơn bằng khoá K → khách tự sửa người nhận/số nhà → app gửi lại place-order bằng đúng khoá K (mất mạng, bấm lại), Postgres thật. Ảnh chụp
 * địa chỉ của đơn không còn khớp sổ địa chỉ, nhưng đó vẫn là cùng một yêu cầu: trả đúng đơn đã có, không đơn thứ hai, không lỗi "thông tin
 * khác". Đổi cách trả tiền với cùng khoá vẫn bị từ chối.
 */
describe('Gửi lại place-order cùng Idempotency-Key sau khi khách tự sửa đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let edit: OrderCustomerEditService;
  const restores: (() => Promise<void>)[] = [];
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
    edit = new OrderCustomerEditService(prisma, moduleRef.get(SystemConfigService));
    restores.push(await pinConfig(prisma, ORDER_CUSTOMER_SELF_EDIT_KEY, true));
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
  });

  afterAll(async () => {
    for (const r of restores.reverse()) await r();
    if (prisma) await deleteItData(prisma, { userIds, productIds });
    await moduleRef?.close();
  });

  async function product() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itrse-p-${tag}`, brand: 'IT', slug: `itrse-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE,
        variations: { create: { pancakeId: `itrse-v-${tag}`, sku: `ITRSE-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: PRICE, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return p.variations[0]!.id;
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
    return { userId: u.id, addressId: addr.id, phone };
  }

  it('đặt bằng K → tự sửa người nhận + số nhà → gửi lại bằng K: cùng mã đơn, đúng 1 đơn, ảnh chụp đã sửa giữ nguyên; addressId của người khác hay đổi sang WALLET với K: 400', async () => {
    const b = await buyer();
    await cart.addItem(b.userId, { variationId: await product(), quantity: 2 });
    const key = `itrse-${randCode(12)}`;
    const first = (await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD' } as never, key)) as { code: string };
    expect(first.code).toBeTruthy();

    await edit.editForOwner(b.userId, first.code, {
      address: { recipient: 'Nguoi Nhan Moi', phone: b.phone, ward: 'Phuong IT', street: '2 Duong Moi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    const edited = await prisma.order.findUniqueOrThrow({ where: { code: first.code } });
    expect(edited.shippingAddress).toMatchObject({ recipient: 'Nguoi Nhan Moi', street: '2 Duong Moi' });

    const replays = await Promise.all(
      Array.from({ length: 3 }, () => checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD' } as never, key) as Promise<{ code: string }>),
    );
    expect(replays.map((r) => r.code)).toEqual([first.code, first.code, first.code]);
    expect(await prisma.order.count({ where: { userId: b.userId } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { code: first.code } })).shippingAddress).toEqual(edited.shippingAddress);

    const stranger = await buyer();
    await expect(checkout.placeOrder(b.userId, { addressId: stranger.addressId, paymentMethod: 'COD' } as never, key)).rejects.toThrow('thông tin khác');

    const err = await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'WALLET' } as never, key).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toContain('thông tin khác');
    expect(await prisma.order.count({ where: { userId: b.userId } })).toBe(1);
  });

  it('chưa tự sửa mà ảnh chụp lệch sổ địa chỉ (khách sửa sổ địa chỉ sau khi đặt): gửi lại bằng K vẫn 400 như cũ', async () => {
    const b = await buyer();
    await cart.addItem(b.userId, { variationId: await product(), quantity: 1 });
    const key = `itrse-${randCode(12)}`;
    const first = (await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD' } as never, key)) as { code: string };
    await prisma.address.update({ where: { id: b.addressId }, data: { street: '99 Duong Khac' } });
    await expect(checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD' } as never, key)).rejects.toThrow('thông tin khác');
    expect(await prisma.order.count({ where: { userId: b.userId } })).toBe(1);
    expect(first.code).toBeTruthy();
  });
});
