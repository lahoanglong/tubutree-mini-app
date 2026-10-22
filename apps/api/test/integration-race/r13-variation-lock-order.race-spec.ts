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
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { createDealer, createOrder, createUser, deleteItData, pinDealerOrderRulesOff, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const STOCK = 100;
const ROUNDS = 5;

/**
 * Mọi đường giữ/trả kho từng khoá dòng biến thể theo thứ tự dòng giỏ/đơn: hai tx cùng hai biến thể nhưng thứ tự dòng ngược nhau
 * (A,B ‖ B,A) mỗi bên giữ một dòng rồi chờ dòng kia (40P01). Tx thứ ba giữ FOR UPDATE CẢ HAI dòng biến thể để ép thứ tự: mỗi
 * bên xếp hàng ở dòng đầu của mình, thả cùng lúc thì (trước fix) mỗi bên lấy được dòng đầu rồi chờ nhau. Sau fix mọi đường khoá
 * theo id nên cả hai cùng xếp hàng ở dòng id nhỏ hơn.
 */
describe('Giữ/trả kho nhiều dòng theo thứ tự id biến thể (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let orders: OrdersService;
  let affiliate: AffiliateService;
  let dealer: DealerService;
  let returns: OrderReturnsService;
  let admin: { id: string };
  const CONFIG_KEYS = ['returns.window_days'];
  let savedConfig: { key: string; value: unknown }[] = [];
  let restoreRules: () => Promise<void>;
  const created = { userIds: [] as string[], productIds: [] as string[] };

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
        DealerService,
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
    affiliate = moduleRef.get(AffiliateService);
    dealer = moduleRef.get(DealerService);
    returns = moduleRef.get(OrderReturnsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    restoreRules = await pinDealerOrderRulesOff(prisma);
    admin = await createUser(prisma, { role: 'ADMIN' });
    created.userIds.push(admin.id);
  });

  afterAll(async () => {
    await restoreRules?.();
    if (prisma) {
      await deleteItData(prisma, created);
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function customer() {
    const u = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(u.id);
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: randomPhone(),
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

  /** Hai biến thể hàng Tubu, trả về theo id tăng dần (lo < hi theo đúng thứ tự Postgres sắp). */
  async function twoVariations() {
    const vs = [];
    for (let i = 0; i < 2; i++) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `itvo-p-${tag}`, brand: 'IT', slug: `itvo-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
      });
      created.productIds.push(product.id);
      vs.push(
        await prisma.variation.create({
          data: { pancakeId: `itvo-v-${tag}`, productId: product.id, sku: `ITVO-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, affiliateRate: 10, stock: STOCK },
        }),
      );
    }
    const sorted = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "variations" WHERE "id" IN (${vs[0]!.id}, ${vs[1]!.id}) ORDER BY "id"`;
    const byId = new Map(vs.map((v) => [v.id, v]));
    return { lo: byId.get(sorted[0]!.id)!, hi: byId.get(sorted[1]!.id)! };
  }

  /** Khách có giỏ đúng thứ tự dòng `ids` (kiểm lại thứ tự dòng mà checkout sẽ đọc: không xanh giả vì giỏ tự sắp theo id). */
  async function cartWith(ids: string[]) {
    // Dòng giỏ không có cột thứ tự: đọc theo thứ tự vật lý, chỗ trống do dòng đã xoá ở vòng trước có thể đảo thứ tự chèn.
    for (let attempt = 0; ; attempt++) {
      const c = await customer();
      for (const variationId of ids) await cart.addItem(c.u.id, { variationId, quantity: 1 });
      const read = (await cart.getCart(c.u.id)).items.map((l) => l.variationId);
      if (attempt < 5 && read.join() !== ids.join()) continue;
      expect(read).toEqual(ids);
      return c;
    }
  }

  async function holdVariations(ids: string[]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" IN (${ids[0]}, ${ids[1]}) ORDER BY "id" FOR UPDATE`;
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

  /** Bên thứ nhất chạy tới khi kẹt ở biến thể đang bị giữ; bên thứ hai cũng vậy; thả cả hai dòng cùng lúc. */
  async function race(ids: string[], first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const hold = await holdVariations(ids);
    const running: Promise<unknown>[] = [];
    // Thả khoá kể cả khi kiểm tra giữa chừng hỏng: không để tx giữ khoá treo DB dùng chung cho các ca sau.
    try {
      let firstSettled = false;
      running.push(first().finally(() => (firstSettled = true)));
      await waitUntil(async () => firstSettled || (await lockWaiters(hold.pid)) >= 1, 'bên thứ nhất');
      expect(firstSettled).toBe(false);
      let secondSettled = false;
      running.push(second().finally(() => (secondSettled = true)));
      await waitUntil(async () => secondSettled || (await lockWaiters(hold.pid)) >= 2, 'bên thứ hai');
      expect(secondSettled).toBe(false);
    } finally {
      hold.release();
      await hold.done;
    }
    return summarize(await Promise.allSettled(running));
  }

  function expectNoErrors(s: { errors: string[] }) {
    expect(s.errors.filter((e) => e.includes('40P01') || e.includes('deadlock'))).toEqual([]);
    expect(s.errors).toEqual([]);
  }

  async function stocks(lo: { id: string }, hi: { id: string }) {
    const rows = await prisma.variation.findMany({ where: { id: { in: [lo.id, hi.id] } }, select: { id: true, stock: true } });
    const m = new Map(rows.map((r) => [r.id, r.stock]));
    return [m.get(lo.id), m.get(hi.id)];
  }

  const place = (c: { u: { id: string }; addr: { id: string } }) => () =>
    checkout.placeOrder(c.u.id, { addressId: c.addr.id, paymentMethod: 'COD' } as never);

  it(`checkout [A,B] ‖ checkout [B,A] → không 40P01, cả hai đơn (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { lo, hi } = await twoVariations();
      const x = await cartWith([lo.id, hi.id]);
      const y = await cartWith([hi.id, lo.id]);
      const s = await race([lo.id, hi.id], place(x), place(y));
      expectNoErrors(s);
      expect(await prisma.order.count({ where: { userId: { in: [x.u.id, y.u.id] } } })).toBe(2);
      expect(await stocks(lo, hi)).toEqual([STOCK - 2, STOCK - 2]);
    }
  });

  it(`khách huỷ đơn có dòng [B,A] ‖ checkout [A,B] → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { lo, hi } = await twoVariations();
      const owner = await customer();
      const line = (v: { id: string }) => ({ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: PRICE, quantity: 1, total: PRICE, paidTotal: PRICE });
      const earlier = await createOrder(prisma, {
        userId: owner.u.id,
        subtotal: 2 * PRICE,
        shippingFee: 0,
        total: 2 * PRICE,
        items: { create: [line(hi), line(lo)] },
      });
      const itemOrder = await prisma.order.findUniqueOrThrow({ where: { id: earlier.id }, include: { items: true } });
      expect(itemOrder.items.map((i) => i.variationId)).toEqual([hi.id, lo.id]);
      await prisma.variation.updateMany({ where: { id: { in: [lo.id, hi.id] } }, data: { stock: STOCK - 1, reservedStock: 1 } });
      const x = await cartWith([lo.id, hi.id]);

      const s = await race([lo.id, hi.id], place(x), () => orders.cancel(owner.u.id, earlier.code));
      expectNoErrors(s);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: earlier.id } })).status).toBe('CANCELLED');
      expect(await prisma.order.count({ where: { userId: x.u.id } })).toBe(1);
      expect(await stocks(lo, hi)).toEqual([STOCK - 1, STOCK - 1]);
    }
  });

  it(`admin xác nhận đã nhận hàng trả các dòng [B,A] ‖ checkout [A,B] → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { lo, hi } = await twoVariations();
      const owner = await customer();
      const line = (v: { id: string }) => ({ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: PRICE, quantity: 1, total: PRICE, paidTotal: PRICE });
      const delivered = await createOrder(prisma, {
        userId: owner.u.id,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        subtotal: 2 * PRICE,
        shippingFee: 0,
        total: 2 * PRICE,
        items: { create: [line(hi), line(lo)] },
      });
      const items = await prisma.orderItem.findMany({ where: { orderId: delivered.id } });
      const itemOf = (v: { id: string }) => items.find((i) => i.variationId === v.id)!.id;
      const req = await returns.request(owner.u.id, delivered.code, {
        reasonCode: 'OTHER',
        reason: 'Không còn nhu cầu dùng nữa',
        items: [
          { orderItemId: itemOf(hi), quantity: 1 },
          { orderItemId: itemOf(lo), quantity: 1 },
        ],
      });
      await returns.review(admin.id, req.id, { approve: true });
      const x = await cartWith([lo.id, hi.id]);

      const s = await race([lo.id, hi.id], place(x), () => returns.markReceived(admin.id, req.id));
      expectNoErrors(s);
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).receivedAt).not.toBeNull();
      expect(await prisma.order.count({ where: { userId: x.u.id } })).toBe(1);
      expect(await stocks(lo, hi)).toEqual([STOCK, STOCK]);
    }
  });

  it('nhiều dòng cùng thiếu hàng → báo dòng thiếu đầu tiên theo thứ tự giỏ, không theo id', async () => {
    const { lo, hi } = await twoVariations();
    const x = await cartWith([hi.id, lo.id]);
    await prisma.variation.updateMany({ where: { id: { in: [lo.id, hi.id] } }, data: { stock: 0 } });
    const names = await prisma.product.findMany({ where: { variations: { some: { id: { in: [lo.id, hi.id] } } } }, include: { variations: true } });
    const nameOf = (id: string) => names.find((p) => p.variations.some((v) => v.id === id))!.name;
    await expect(place(x)()).rejects.toThrow(`Sản phẩm "${nameOf(hi.id)}" không đủ tồn kho.`);
    expect(await stocks(lo, hi)).toEqual([0, 0]);
  });

  it(`CTV lên đơn hộ [B,A] ‖ checkout [A,B] → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { lo, hi } = await twoVariations();
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      created.userIds.push(ctv.id);
      const x = await cartWith([lo.id, hi.id]);
      const dto = {
        items: [
          { variationId: hi.id, quantity: 1 },
          { variationId: lo.id, quantity: 1 },
        ],
        customer: { recipient: 'Khách của CTV', phone: randomPhone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT', provinceCode: '84_VN01', wardCode: '00001' },
        paymentMethod: 'COD' as const,
      };

      const s = await race([lo.id, hi.id], place(x), () => affiliate.placeOrderForCustomer(ctv.id, dto));
      expectNoErrors(s);
      expect(await prisma.order.count({ where: { userId: { in: [x.u.id, ctv.id] } } })).toBe(2);
      expect(await stocks(lo, hi)).toEqual([STOCK - 2, STOCK - 2]);
    }
  });

  it(`đại lý đặt [B,A] ‖ checkout [A,B] → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { lo, hi } = await twoVariations();
      const d = await createDealer(prisma);
      created.userIds.push(d.id);
      const x = await cartWith([lo.id, hi.id]);
      const dto = {
        items: [
          { variationId: hi.id, quantity: 1 },
          { variationId: lo.id, quantity: 1 },
        ],
        paymentMethod: 'PREPAID',
      };

      const s = await race([lo.id, hi.id], place(x), () => dealer.placeOrder(d.id, dto));
      expectNoErrors(s);
      expect(await prisma.order.count({ where: { userId: { in: [x.u.id, d.id] } } })).toBe(2);
      expect(await stocks(lo, hi)).toEqual([STOCK - 2, STOCK - 2]);
    }
  });
});
