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
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { barrierOnFirstCalls, createUser, deleteItData, randCode, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const FLASH_PRICE = 60_000;
const ROUNDS = 8;

/**
 * Món cuối của một khung Giờ vàng (Postgres thật). Hai khách có giỏ cùng một biến thể còn đúng một suất, mỗi người đều đã thấy giá Giờ
 * vàng trong giỏ (rào chắn ở resolveEffective buộc cả hai đọc trước khi ai trừ suất): chỉ ràng buộc trừ suất ở DB được quyết định ai
 * mua được. Người thua nhận PRICE_CHANGED (hỏi lại giá), không bị trừ suất, không có đơn. Khách vượt giới hạn mua giữa lúc xem giỏ và
 * lúc đặt nhận FLASH_LIMIT kèm giới hạn đúng của suất đó và đơn bị huỷ nguyên. Sau đơn thắng, trang Giờ vàng báo món hết suất.
 */
describe('Khung Giờ vàng: hai khách mua món cuối, giới hạn mỗi khách, trạng thái hết suất (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let flash: FlashSaleService;
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        WalletLedgerService,
        CashbackService,
        ComboService,
        FlashSaleService,
        OrderReversalService,
        OrderStatusService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    flash = moduleRef.get(FlashSaleService);
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await moduleRef?.close();
  });

  async function customer() {
    const u = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(u.id);
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
    return { u, addr };
  }

  /** Một khung đang chạy có đúng một món: biến thể tồn 100, suất `quota`, mỗi khách tối đa `perUserLimit`. */
  async function slot(quota: number, perUserLimit: number) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Khung IT ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(sale.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itfs-p-${tag}`, brand: 'IT', slug: `itfs-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `itfs-v-${tag}`, productId: product.id, sku: `ITFS-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
    const item = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: v.id, flashPrice: FLASH_PRICE, quota, soldCount: 0, perUserLimit },
    });
    return { sale, v, item };
  }

  const order = (c: Awaited<ReturnType<typeof customer>>) =>
    checkout.placeOrder(c.u.id, { addressId: c.addr.id, paymentMethod: 'COD' } as never);

  it(`hai khách mua món cuối đồng thời (${ROUNDS} vòng): đúng một đơn, người kia PRICE_CHANGED, soldCount = 1, một dòng lượt mua`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await slot(1, 5);
      const a = await customer();
      const b = await customer();
      await cart.addItem(a.u.id, { variationId: s.v.id, quantity: 1 });
      await cart.addItem(b.u.id, { variationId: s.v.id, quantity: 1 });
      const barrier = barrierOnFirstCalls(flash, 'resolveEffective', 2);
      let settled: PromiseSettledResult<unknown>[];
      try {
        settled = await Promise.allSettled([order(a), order(b)]);
      } finally {
        barrier.mockRestore();
      }
      const r = summarize(settled);
      expect(r.fulfilled).toHaveLength(1);
      expect(r.errors).toEqual([expect.stringContaining('PRICE_CHANGED')]);

      const item = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: s.item.id } });
      expect(item.soldCount).toBe(1);
      expect(await prisma.flashSalePurchase.count({ where: { flashSaleItemId: s.item.id } })).toBe(1);
      const orders = await prisma.order.findMany({ where: { userId: { in: [a.u.id, b.u.id] } }, include: { items: true } });
      expect(orders).toHaveLength(1);
      expect(orders[0]!.items.map((i) => [i.flashSaleItemId, i.unitPrice])).toEqual([[s.item.id, FLASH_PRICE]]);
    }
  });

  it('một khách vượt giới hạn mua giữa lúc xem giỏ và lúc đặt: FLASH_LIMIT kèm limit của suất, đơn huỷ nguyên, suất không bị trừ', async () => {
    const s = await slot(10, 5);
    const c = await customer();
    await cart.addItem(c.u.id, { variationId: s.v.id, quantity: 3 });
    const original = flash.resolveEffective.bind(flash);
    const spy = jest.spyOn(flash, 'resolveEffective').mockImplementationOnce(async (...args) => {
      const priced = await original(...args);
      await prisma.flashSaleItem.update({ where: { id: s.item.id }, data: { perUserLimit: 2 } });
      return priced;
    });
    let err: unknown;
    try {
      await order(c);
    } catch (e) {
      err = e;
    } finally {
      spy.mockRestore();
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: 'FLASH_LIMIT',
      limit: 2,
      message: 'Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.',
    });
    expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: s.item.id } })).soldCount).toBe(0);
    expect(await prisma.flashSalePurchase.count({ where: { flashSaleItemId: s.item.id } })).toBe(0);
    expect(await prisma.order.count({ where: { userId: c.u.id } })).toBe(0);
  });

  it('sau đơn thắng món cuối, GET /slots/:id/items báo soldOut và khung vẫn là LIVE', async () => {
    const s = await slot(1, 5);
    const c = await customer();
    await cart.addItem(c.u.id, { variationId: s.v.id, quantity: 1 });
    await order(c);
    const res = await flash.listSlotItems(s.sale.id);
    expect(res.slot).toMatchObject({ id: s.sale.id, status: 'LIVE' });
    expect(res.items.map((i) => [i.itemId, i.soldOut, i.soldCount, i.quota])).toEqual([[s.item.id, true, 1, 1]]);
  });
});
