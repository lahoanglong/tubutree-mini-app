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
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const FLASH_PRICE = 50_000;
const ROUNDS = 5;

/**
 * Hoàn suất giờ vàng khi duyệt trả phải khoá flash_sale_items theo id như lần đặt đơn (trừ suất theo id). Đơn đã giao của R có
 * dòng [B, A] với id(A) < id(B); U đặt giỏ có A và B. Tx thứ ba giữ suất A: lần đặt xếp hàng trước ở A, lần duyệt (đã hoàn B
 * nếu đi theo thứ tự dòng đơn) xếp hàng sau ở A; thả ra thì lần đặt lấy A rồi chờ B ⇒ 40P01 nếu lần duyệt đang giữ B.
 */
describe('Duyệt trả đơn nhiều dòng giờ vàng ‖ đặt đơn cùng các suất đó (real Postgres)', () => {
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

  /** R có đơn đã giao gồm dòng [B, A] (mỗi dòng 2 suất), id(A) < id(B); yêu cầu trả `perLine` mỗi dòng; giỏ U có A và B. */
  async function scenario(perLine: number) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(sale.id);
    const a = await flashLine(sale.id);
    const b = await flashLine(sale.id);
    expect(a.flash.id < b.flash.id).toBe(true);
    const owner = await createUser(prisma, { role: 'CUSTOMER' });
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(owner.id, buyer.id);
    const addr = await prisma.address.create({
      data: {
        userId: buyer.id,
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
    for (const x of [a, b]) {
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: x.flash.id, userId: owner.id, quantity: 2 } });
      await prisma.flashSaleItem.update({ where: { id: x.flash.id }, data: { soldCount: 2 } });
    }
    const line = { productName: 'Nước giặt', variationName: 'Chai', unitPrice: FLASH_PRICE, quantity: 2, total: PRICE, paidTotal: PRICE };
    const order = await createOrder(prisma, {
      userId: owner.id,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      subtotal: 2 * PRICE,
      shippingFee: 0,
      total: 2 * PRICE,
      items: {
        create: [
          { ...line, variationId: b.v.id, flashSaleItemId: b.flash.id },
          { ...line, variationId: a.v.id, flashSaleItemId: a.flash.id },
        ],
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items.map((i) => i.flashSaleItemId)).toEqual([b.flash.id, a.flash.id]);
    const req = await returns.request(owner.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: items.map((i) => ({ orderItemId: i.id, quantity: perLine })),
    });
    await cart.addItem(buyer.id, { variationId: a.v.id, quantity: 1 });
    await cart.addItem(buyer.id, { variationId: b.v.id, quantity: 1 });
    return { a, b, owner, buyer, addr, order, req };
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

  it.each([
    { perLine: 2, what: 'trả cả đơn (reverseFinancials)', status: 'RETURNED' },
    { perLine: 1, what: 'trả một phần (reversePartialReturn)', status: 'DELIVERED' },
  ])(`duyệt $what đơn có dòng [B, A] ‖ đặt đơn có A, B → không 40P01 (${ROUNDS} vòng)`, async ({ perLine, status }) => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario(perLine);
      const holder = await holdFlashItem(s.a.flash.id);
      const running: Promise<unknown>[] = [];
      try {
        let placeSettled = false;
        running.push(
          checkout.placeOrder(s.buyer.id, { addressId: s.addr.id, paymentMethod: 'COD' } as never).finally(() => (placeSettled = true)),
        );
        await waitUntil(async () => placeSettled || (await lockWaiters(holder.pid)) >= 1, 'đặt đơn');
        expect(placeSettled).toBe(false);
        let reviewSettled = false;
        running.push(returns.review(admin.id, s.req.id, { approve: true }).finally(() => (reviewSettled = true)));
        await waitUntil(async () => reviewSettled || (await lockWaiters(holder.pid)) >= 2, 'duyệt trả');
        expect(reviewSettled).toBe(false);
      } finally {
        holder.release();
        await holder.done;
      }
      const settled = await Promise.allSettled(running);
      const r = summarize(settled);
      expect(r.errors.filter((e) => e.includes('40P01') || e.includes('deadlock') || e.includes('đang bận'))).toEqual([]);
      expect(r.errors).toEqual([]);
      expect(settled.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);

      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: s.req.id } })).status).toBe('APPROVED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe(status);
      const placed = await prisma.order.findMany({ where: { userId: s.buyer.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.flashSaleItemId).sort())).toEqual([[s.a.flash.id, s.b.flash.id].sort()]);
      for (const x of [s.a, s.b]) {
        const rows = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: x.flash.id } });
        expect(new Map(rows.map((p) => [p.userId, p.quantity]))).toEqual(
          new Map([
            [s.owner.id, 2 - perLine],
            [s.buyer.id, 1],
          ]),
        );
        expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: x.flash.id } })).soldCount).toBe(2 - perLine + 1);
      }
      for (const u of [s.owner.id, s.buyer.id]) {
        const row = await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { pointsBalance: true } });
        const ledger = await prisma.pointsTransaction.aggregate({ where: { userId: u, lot: 'STANDARD' }, _sum: { delta: true } });
        expect(row.pointsBalance).toBe(ledger._sum.delta ?? 0);
      }
    }
  });
});
