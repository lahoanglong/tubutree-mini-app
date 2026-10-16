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
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const FLASH_PRICE = 50_000;
const REWARD = 100;
const ROUNDS = 5;

/**
 * Trừ suất giờ vàng không được giữ khoá dòng users của khách (KEY SHARE chặn FOR UPDATE) trong lúc còn phải khoá suất giờ vàng
 * của dòng khác. Admin duyệt trả một phần đơn của người được mời R (có suất B) hoàn suất B rồi khoá người mời U (FOR UPDATE, thu
 * hồi thưởng giới thiệu); U đặt đơn có B cùng dòng giờ vàng khác: A (U đã có dòng suất A) hoặc C (U chưa có dòng suất). Tx thứ ba
 * giữ dòng suất B: lần duyệt xếp hàng trước, lần đặt (đã xong các dòng trước B) xếp hàng sau; thả ra thì lần duyệt lấy B rồi chờ
 * users của U.
 */
describe('Đặt đơn nhiều dòng giờ vàng ‖ duyệt trả một phần đơn của người được mời (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let returns: OrderReturnsService;
  let admin: { id: string };
  const CONFIG_KEYS = ['returns.window_days'];
  let savedConfig: { key: string; value: unknown }[] = [];
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
        OrderReturnsService,
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
    returns = moduleRef.get(OrderReturnsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
    created.userIds.push(admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      await deleteItData(prisma, created);
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function flashLine(saleId: string) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itfx-p-${tag}`, brand: 'IT', slug: `itfx-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `itfx-v-${tag}`, productId: product.id, sku: `ITFX-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
    const flash = await prisma.flashSaleItem.create({
      data: { flashSaleId: saleId, variationId: v.id, flashPrice: FLASH_PRICE, quota: 100, soldCount: 0, perUserLimit: 10 },
    });
    return { v, flash };
  }

  /**
   * U mời R; U đã mua 1 suất A, chưa mua C; R có đơn thứ hai đã giao gồm 2 suất B và yêu cầu trả 1; U nhận thưởng giới thiệu
   * cho R. Giỏ của U gồm các dòng `cartOf` theo đúng thứ tự đó.
   */
  async function scenario(cartOf: ('A' | 'B' | 'C')[]) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(sale.id);
    const a = await flashLine(sale.id);
    const b = await flashLine(sale.id);
    const c = await flashLine(sale.id);
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    created.userIds.push(referrer.id, referee.id);
    const addr = await prisma.address.create({
      data: {
        userId: referrer.id,
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
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: a.flash.id, userId: referrer.id, quantity: 1 } });
    await prisma.flashSaleItem.update({ where: { id: a.flash.id }, data: { soldCount: 1 } });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: b.flash.id, userId: referee.id, quantity: 2 } });
    await prisma.flashSaleItem.update({ where: { id: b.flash.id }, data: { soldCount: 2 } });
    const line = { productName: 'Nước giặt', variationName: 'Chai', unitPrice: FLASH_PRICE, quantity: 2, total: PRICE, paidTotal: PRICE };
    const first = await createOrder(prisma, {
      userId: referee.id,
      status: 'DELIVERED',
      deliveredAt: new Date(now - 864e5),
      subtotal: PRICE,
      shippingFee: 0,
      total: PRICE,
      items: { create: [{ ...line, variationId: a.v.id }] },
    });
    const second = await createOrder(prisma, {
      userId: referee.id,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      subtotal: PRICE,
      shippingFee: 0,
      total: PRICE,
      items: { create: [{ ...line, variationId: b.v.id, flashSaleItemId: b.flash.id }] },
    });
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, {
        userId: referrer.id,
        delta: REWARD,
        lot: 'STANDARD',
        reason: `REFERRAL_ORDER2:${referee.id}`,
        refType: 'REFERRAL',
        refId: `${first.id}:${second.id}`,
      }),
    );
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: second.id } });
    const req = await returns.request(referee.id, second.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    const lines = cartOf.map((k) => ({ A: a, B: b, C: c })[k]);
    // Dòng giỏ không có cột thứ tự (đọc theo thứ tự vật lý): chèn lại tới khi checkout đọc đúng thứ tự cần tái hiện.
    for (let attempt = 0; ; attempt++) {
      for (const l of lines) await cart.addItem(referrer.id, { variationId: l.v.id, quantity: 1 });
      const read = (await cart.getCart(referrer.id)).items.map((l) => l.flashSaleItemId);
      const want = lines.map((l) => l.flash.id);
      if (attempt < 5 && read.join() !== want.join()) {
        await prisma.cartItem.deleteMany({ where: { cart: { userId: referrer.id } } });
        continue;
      }
      expect(read).toEqual(want);
      break;
    }
    return { a, b, c, referrer, referee, addr, req };
  }

  async function holdFlashItem(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "flash_sale_items" WHERE "id" = ${id} FOR UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

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

  const CASES: { cart: ('A' | 'B' | 'C')[]; what: string }[] = [
    { cart: ['A', 'B'], what: '[A đã có dòng suất, B]' },
    { cart: ['C', 'B'], what: '[C chưa có dòng suất, B]' },
    { cart: ['C', 'A', 'B'], what: '[C chưa có dòng suất, A đã có, B chưa có]' },
  ];

  it.each(CASES)(`duyệt trả một phần (hoàn suất B rồi khoá người mời) ‖ người mời đặt $what → không 40P01 (${ROUNDS} vòng)`, async ({ cart: cartOf }) => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario(cartOf);
      const holder = await holdFlashItem(s.b.flash.id);
      const running: Promise<unknown>[] = [];
      try {
        let reviewSettled = false;
        running.push(returns.review(admin.id, s.req.id, { approve: true }).finally(() => (reviewSettled = true)));
        await waitUntil(async () => reviewSettled || (await lockWaiters(holder.pid)) >= 1, 'duyệt trả');
        expect(reviewSettled).toBe(false);
        let placeSettled = false;
        running.push(
          checkout.placeOrder(s.referrer.id, { addressId: s.addr.id, paymentMethod: 'COD' } as never).finally(() => (placeSettled = true)),
        );
        await waitUntil(async () => placeSettled || (await lockWaiters(holder.pid)) >= 2, 'đặt đơn');
        expect(placeSettled).toBe(false);
      } finally {
        holder.release();
        await holder.done;
      }
      const settled = await Promise.allSettled(running);
      const r = summarize(settled);
      expect(r.errors.filter((e) => e.includes('40P01') || e.includes('deadlock'))).toEqual([]);
      expect(r.errors).toEqual([]);
      expect(settled.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);

      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: s.req.id } })).status).toBe('APPROVED');
      const items = { A: s.a, B: s.b, C: s.c };
      const placed = await prisma.order.findMany({ where: { userId: s.referrer.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.flashSaleItemId).sort())).toEqual([cartOf.map((k) => items[k].flash.id).sort()]);
      const bought = { A: 1 + (cartOf.includes('A') ? 1 : 0), B: 1, C: cartOf.includes('C') ? 1 : 0 };
      const purchases = await prisma.flashSalePurchase.findMany({ where: { userId: s.referrer.id } });
      expect(new Map(purchases.map((p) => [p.flashSaleItemId, p.quantity]))).toEqual(
        new Map((['A', 'B', 'C'] as const).filter((k) => bought[k] > 0).map((k) => [items[k].flash.id, bought[k]])),
      );
      // soldCount = tổng dòng suất: A (U), B (R còn 1 sau khi trả 1 + U 1), C (U).
      const sold = { A: bought.A, B: 1 + bought.B, C: bought.C };
      for (const k of ['A', 'B', 'C'] as const) {
        expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: items[k].flash.id } })).soldCount).toBe(sold[k]);
      }
      for (const u of [s.referrer.id, s.referee.id]) {
        const row = await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { pointsBalance: true } });
        const ledger = await prisma.pointsTransaction.aggregate({ where: { userId: u, lot: 'STANDARD' }, _sum: { delta: true } });
        expect(row.pointsBalance).toBe(ledger._sum.delta ?? 0);
      }
      expect(
        await prisma.pointsTransaction.count({ where: { userId: s.referrer.id, reason: { startsWith: 'REFERRAL_ORDER2_PARTIAL_REVOKE:' } } }),
      ).toBe(1);
    }
  });
});
