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
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { createOrder, createUser, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const FLASH_PRICE = 50_000;
const SEED_POINTS = 1_000;
const POINTS_USED = 10;
const EARNED = 30;
const ROUNDS = 10;

/**
 * Đặt đơn tiêu Điểm Xanh giữ khoá dòng variation (giữ kho) / dòng suất flash (consumeQuota) rồi mới khoá dòng users. Lần đảo
 * tiền của đơn TRƯỚC của cùng khách (khách huỷ đơn trả Ví; admin duyệt trả một phần) từng ghi dòng users (hoàn Ví) TRƯỚC rồi mới
 * cộng kho / hoàn suất flash cùng dòng đó ⇒ hai tx chờ nhau (40P01). Tx thứ ba giữ FOR UPDATE dòng users để ép thứ tự: đặt đơn
 * đã giữ kho/suất và kẹt ở bước chèn đơn (KEY SHARE của FK), lần đảo kẹt ở bước khoá users hoặc xếp hàng sau đặt đơn; thả ra là
 * (trước fix) chu trình.
 */
describe('Đặt đơn tiêu điểm ‖ đảo tiền đơn trước của cùng khách trên cùng variation/suất flash (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let orders: OrdersService;
  let returns: OrderReturnsService;
  let admin: { id: string };

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
        OrderReturnsService,
        OrdersService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
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
    orders = moduleRef.get(OrdersService);
    returns = moduleRef.get(OrderReturnsService);
    // Phải có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1000);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Khách có SEED_POINTS điểm thường khớp sổ và một địa chỉ. */
  async function customer() {
    const u = await createUser(prisma, { role: 'CUSTOMER', pointsBalance: SEED_POINTS });
    await prisma.pointsTransaction.create({ data: { userId: u.id, delta: SEED_POINTS, lot: 'STANDARD', reason: 'IT_SEED_STANDARD', refType: 'IT' } });
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

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itlo-p-${tag}`, brand: 'IT', slug: `itlo-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    return prisma.variation.create({
      data: { pancakeId: `itlo-v-${tag}`, productId: product.id, sku: `ITLO-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
  }

  async function holdUserForUpdate(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  /** Số phiên đang chờ (trực tiếp hoặc xếp hàng sau phiên đang chờ) khoá do tx `holderPid` giữ. */
  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitUntil(cond: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; !(await cond()); i++) {
      if (i > 200) throw new Error(`${what} không tới chỗ chờ khoá`);
      await sleep(25);
    }
  }

  /**
   * Đặt đơn chạy tới khi kẹt sau tx giữ FOR UPDATE dòng users (đã giữ kho/suất); rồi lần đảo chạy tới khi cũng kẹt (trực tiếp
   * hoặc sau đặt đơn); thả khoá.
   */
  async function raceCheckoutWith(userId: string, place: () => Promise<unknown>, reverse: () => Promise<unknown>) {
    const hold = await holdUserForUpdate(userId);
    let placeSettled = false;
    const placing = place().finally(() => (placeSettled = true));
    await waitUntil(async () => placeSettled || (await lockWaiters(hold.pid)) >= 1, 'đặt đơn');
    let reverseSettled = false;
    const reversing = reverse().finally(() => (reverseSettled = true));
    await waitUntil(async () => reverseSettled || (await lockWaiters(hold.pid)) >= (placeSettled ? 1 : 2), 'lần đảo');
    hold.release();
    await hold.done;
    return summarize(await Promise.allSettled([placing, reversing]));
  }

  async function ledgerInvariants(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, walletBalance: true } });
    const points = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    const wallet = await prisma.walletTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(points._sum.delta ?? 0);
    expect(u.walletBalance).toBe(wallet._sum.delta ?? 0);
    return u;
  }

  it(`(A) đặt đơn tiêu điểm ‖ khách huỷ đơn trước trả bằng Ví cùng variation → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { u, addr } = await customer();
      const v = await variation();
      const earlier = await createOrder(prisma, {
        userId: u.id,
        status: 'CONFIRMED',
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        subtotal: PRICE,
        shippingFee: 0,
        total: PRICE,
        items: { create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: PRICE, quantity: 1, total: PRICE, paidTotal: PRICE }] },
      });
      await prisma.walletTransaction.create({ data: { userId: u.id, delta: PRICE, balanceAfter: PRICE, type: 'OPENING', refType: 'IT', refId: earlier.id } });
      await prisma.user.update({ where: { id: u.id }, data: { walletBalance: PRICE } });
      await cart.addItem(u.id, { variationId: v.id, quantity: 1 });

      const s = await raceCheckoutWith(
        u.id,
        () => checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: POINTS_USED } as never),
        () => orders.cancel(u.id, earlier.code),
      );
      expect(s.errors).toEqual([]);

      expect((await prisma.order.findUniqueOrThrow({ where: { id: earlier.id } })).status).toBe('CANCELLED');
      expect(await prisma.walletTransaction.count({ where: { userId: u.id, type: 'ORDER_REFUND', refId: earlier.id } })).toBe(1);
      const placed = await prisma.order.findMany({ where: { userId: u.id, id: { not: earlier.id } } });
      expect(placed.map((o) => o.pointsUsed)).toEqual([POINTS_USED]);
      const after = await ledgerInvariants(u.id);
      expect(after.pointsBalance).toBe(SEED_POINTS - POINTS_USED);
      expect(after.walletBalance).toBe(2 * PRICE);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(100);
    }
  });

  it(`(B) đặt đơn tiêu điểm cùng suất flash ‖ admin duyệt trả một phần đơn trước có suất đó → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { u, addr } = await customer();
      const v = await variation();
      const now = Date.now();
      const sale = await prisma.flashSale.create({
        data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
      });
      const flash = await prisma.flashSaleItem.create({
        data: { flashSaleId: sale.id, variationId: v.id, flashPrice: FLASH_PRICE, quota: 100, soldCount: 3, perUserLimit: 10 },
      });
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: u.id, quantity: 3 } });
      const total = 3 * FLASH_PRICE;
      const delivered = await createOrder(prisma, {
        userId: u.id,
        status: 'DELIVERED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        pointsEarned: EARNED,
        deliveredAt: new Date(),
        subtotal: total,
        shippingFee: 0,
        total,
        items: {
          create: [
            {
              variationId: v.id,
              productName: 'Nước giặt',
              variationName: 'Chai',
              unitPrice: FLASH_PRICE,
              quantity: 3,
              total,
              paidTotal: total,
              flashSaleItemId: flash.id,
            },
          ],
        },
      });
      await prisma.$transaction([
        prisma.pointsTransaction.create({
          data: {
            userId: u.id,
            delta: EARNED,
            lot: 'STANDARD',
            reason: `ORDER_DELIVERED:${delivered.code}`,
            refType: 'ORDER',
            refId: delivered.id,
            expiresAt: new Date(now + 365 * 864e5),
          },
        }),
        prisma.user.update({ where: { id: u.id }, data: { pointsBalance: { increment: EARNED } } }),
      ]);
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: delivered.id } });
      const req = await returns.request(u.id, delivered.code, {
        reasonCode: 'OTHER',
        reason: 'Không còn nhu cầu dùng nữa',
        items: [{ orderItemId: item.id, quantity: 1 }],
      });
      await cart.addItem(u.id, { variationId: v.id, quantity: 1 });

      const s = await raceCheckoutWith(
        u.id,
        () => checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: POINTS_USED } as never),
        () => returns.review(admin.id, req.id, { approve: true }),
      );
      expect(s.errors).toEqual([]);

      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');
      expect(await prisma.walletTransaction.count({ where: { userId: u.id, type: 'ORDER_REFUND', refId: req.id } })).toBe(1);
      const placed = await prisma.order.findMany({ where: { userId: u.id, id: { not: delivered.id } }, include: { items: true } });
      expect(placed.map((o) => [o.pointsUsed, o.items[0]?.flashSaleItemId])).toEqual([[POINTS_USED, flash.id]]);
      const after = await ledgerInvariants(u.id);
      expect(after.walletBalance).toBeGreaterThan(0);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(3);
      const purchase = await prisma.flashSalePurchase.findUniqueOrThrow({ where: { flashSaleItemId_userId: { flashSaleItemId: flash.id, userId: u.id } } });
      expect(purchase.quantity).toBe(3);
    }
  });
});
