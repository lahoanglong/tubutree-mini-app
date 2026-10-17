import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
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
import { createUser, deleteItData, randCode, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const FLASH_PRICE = 50_000;
const STOCK = 100;
const GUEST_FLASH_QTY = 1;
const ROUNDS = 5;

/**
 * Gộp phiên khách G vào tài khoản T ‖ đặt đơn của G hoặc của T (UAT vòng 6, hai vòng khoá có từ trước):
 *  - (b) T đặt đơn giờ vàng lần đầu (chèn dòng flash_sale_purchases MỚI của T) trong khi gộp chuyển dòng suất của G sang T: đặt
 *    đơn giữ mục chỉ mục (suất, T) chưa commit rồi chờ KEY SHARE dòng users của T (khoá ngoại), gộp giữ FOR UPDATE users của T
 *    rồi chờ chính mục chỉ mục đó.
 *  - (c) giỏ: đặt đơn khoá giỏ (FOR NO KEY UPDATE) đầu tx rồi mới chạm users; gộp khoá users rồi mới xoá/chuyển giỏ.
 * Tx thứ ba ép thứ tự: giữ dòng địa chỉ của G (gộp dừng ở bước chuyển địa chỉ, đã giữ users), dòng users của T hoặc dòng biến
 * thể (đặt đơn dừng sau khi đã khoá giỏ/chèn suất).
 */
describe('Gộp phiên khách ‖ đặt đơn của khách hoặc của tài khoản đích (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let affiliate: AffiliateService;
  let auth: AuthService;
  let zaloIdForNextCall = '';
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
    affiliate = moduleRef.get(AffiliateService);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-r13', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function address(userId: string) {
    return prisma.address.create({
      data: {
        userId,
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
  }

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itmc-p-${tag}`, brand: 'IT', slug: `itmc-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    return prisma.variation.create({
      data: { pancakeId: `itmc-v-${tag}`, productId: product.id, sku: `ITMC-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: STOCK },
    });
  }

  /** Khách G (có địa chỉ) và tài khoản Zalo T (có địa chỉ). */
  /** `ids`: ép id khách nhỏ hơn id đích để gộp khoá users của khách trước (referralLockOrder sắp theo id khi không có cạnh mời). */
  async function pair(ids?: { guest: string; target: string }) {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, ...(ids ? { id: ids.guest } : {}) });
    const target = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}`, ...(ids ? { id: ids.target } : {}) });
    created.userIds.push(guest.id, target.id);
    const guestAddr = await address(guest.id);
    const targetAddr = await address(target.id);
    return { guest, target, guestAddr, targetAddr };
  }

  /** Suất giờ vàng của biến thể v; G đã mua GUEST_FLASH_QTY suất. */
  async function flashItem(v: { id: string }, soldCount = 0) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(sale.id);
    return prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: v.id, flashPrice: FLASH_PRICE, quota: 100, soldCount, perUserLimit: 10 },
    });
  }

  async function flashWithGuestPurchase(v: { id: string }, guestId: string) {
    const flash = await flashItem(v, GUEST_FLASH_QTY);
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: guestId, quantity: GUEST_FLASH_QTY } });
    return flash;
  }

  async function hold(lock: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await lock(tx);
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

  /**
   * `first` chạy tới khi kẹt (trực tiếp hoặc gián tiếp) sau tx giữ khoá; rồi `second` cũng chạy tới khi kẹt, hoặc chạy xong nếu
   * nó không chạm khoá nào `first` đang giữ; thả khoá. Luôn thả khoá kể cả khi kiểm tra giữa chừng hỏng (không treo DB dùng chung).
   */
  async function race(
    holder: Awaited<ReturnType<typeof hold>>,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    const running: Promise<unknown>[] = [];
    try {
      let firstSettled = false;
      running.push(first().finally(() => (firstSettled = true)));
      await waitUntil(async () => firstSettled || (await lockWaiters(holder.pid)) >= 1, 'bên thứ nhất');
      expect(firstSettled).toBe(false);
      let secondSettled = false;
      running.push(second().finally(() => (secondSettled = true)));
      await waitUntil(async () => secondSettled || (await lockWaiters(holder.pid)) >= 2, 'bên thứ hai');
    } finally {
      holder.release();
      await holder.done;
    }
    return summarize(await Promise.allSettled(running));
  }

  /** Gộp thua deadlock thì AuthService trả 503 "đang bận" (isMergeBusy): cũng là vòng khoá. */
  function expectNoErrors(s: { errors: string[] }) {
    expect(s.errors.filter((e) => e.includes('40P01') || e.includes('deadlock') || e.includes('đang bận'))).toEqual([]);
    expect(s.errors).toEqual([]);
  }

  const merge = (p: Awaited<ReturnType<typeof pair>>) => () => {
    zaloIdForNextCall = p.target.zaloId!;
    return auth.ensurePhoneForCurrentUser(p.guest.id, 'code', 'access');
  };
  const place = (userId: string, addressId: string) => () => checkout.placeOrder(userId, { addressId, paymentMethod: 'COD' } as never);

  async function expectMerged(p: Awaited<ReturnType<typeof pair>>) {
    const g = await prisma.user.findUniqueOrThrow({ where: { id: p.guest.id } });
    expect(g.zaloId).toContain('_merged_');
    expect(g.mergedIntoId).toBe(p.target.id);
  }

  it(`(b) gộp giữ users của T trước ‖ T đặt đơn giờ vàng lần đầu (dòng suất mới) → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      const v = await variation();
      const flash = await flashWithGuestPurchase(v, p.guest.id);
      await cart.addItem(p.target.id, { variationId: v.id, quantity: 1 });
      expect((await cart.getCart(p.target.id)).items.map((l) => l.flashSaleItemId)).toEqual([flash.id]);

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${p.guestAddr.id} FOR UPDATE`);
      const s = await race(holder, merge(p), place(p.target.id, p.targetAddr.id));
      expectNoErrors(s);

      await expectMerged(p);
      const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: flash.id } });
      expect(purchases.map((x) => [x.userId, x.quantity])).toEqual([[p.target.id, GUEST_FLASH_QTY + 1]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(GUEST_FLASH_QTY + 1);
      const placed = await prisma.order.findMany({ where: { userId: p.target.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.flashSaleItemId))).toEqual([[flash.id]]);
    }
  });

  it(`(b) T đặt đơn giờ vàng lần đầu đã chèn dòng suất ‖ gộp tới sau → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      const v = await variation();
      const flash = await flashWithGuestPurchase(v, p.guest.id);
      await cart.addItem(p.target.id, { variationId: v.id, quantity: 1 });

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${p.target.id} FOR UPDATE`);
      const s = await race(holder, place(p.target.id, p.targetAddr.id), merge(p));
      expectNoErrors(s);

      await expectMerged(p);
      const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: flash.id } });
      expect(purchases.map((x) => [x.userId, x.quantity])).toEqual([[p.target.id, GUEST_FLASH_QTY + 1]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(GUEST_FLASH_QTY + 1);
    }
  });

  /** CTV lên đơn hộ không đi qua giỏ: chỉ thứ tự khoá trong lần trừ suất giờ vàng tách nó khỏi lần gộp. */
  it(`(b) gộp giữ users của CTV T trước ‖ T lên đơn hộ giờ vàng lần đầu (dòng suất mới) → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      await prisma.user.update({ where: { id: p.target.id }, data: { role: 'AFFILIATE', phone: randomPhone() } });
      const v = await variation();
      const flash = await flashWithGuestPurchase(v, p.guest.id);
      const dto = {
        items: [{ variationId: v.id, quantity: 1 }],
        customer: { recipient: 'Khách của CTV', phone: randomPhone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT', provinceCode: '84_VN01', wardCode: '00001' },
        paymentMethod: 'COD' as const,
      };

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${p.guestAddr.id} FOR UPDATE`);
      const s = await race(holder, merge(p), () => affiliate.placeOrderForCustomer(p.target.id, dto));
      expectNoErrors(s);

      await expectMerged(p);
      const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: flash.id } });
      expect(purchases.map((x) => [x.userId, x.quantity])).toEqual([[p.target.id, GUEST_FLASH_QTY + 1]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(GUEST_FLASH_QTY + 1);
      const placed = await prisma.order.findMany({ where: { userId: p.target.id, placedForCustomer: true }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.flashSaleItemId))).toEqual([[flash.id]]);
    }
  });

  /**
   * Đích ĐÃ có dòng suất: gộp khoá dòng suất của khách và của đích rồi mới khoá users (khách trước, đích sau). Lần CTV lên hộ không
   * được giữ khoá users của đích (KEY SHARE chặn FOR UPDATE của gộp) trong lúc chờ dòng suất mà gộp đang giữ. Tx thứ ba giữ users
   * của khách: gộp dừng giữa khoá dòng suất và khoá users; lần lên hộ tới sau kẹt ở dòng suất của đích.
   */
  it(`(b) đích đã có dòng suất: gộp đã khoá dòng suất ‖ CTV T lên đơn hộ giờ vàng → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const tag = randCode(10).toLowerCase();
      const p = await pair({ guest: `itr13-a-${tag}`, target: `itr13-b-${tag}` });
      await prisma.user.update({ where: { id: p.target.id }, data: { role: 'AFFILIATE', phone: randomPhone() } });
      const v = await variation();
      const flash = await flashWithGuestPurchase(v, p.guest.id);
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: p.target.id, quantity: 1 } });
      await prisma.flashSaleItem.update({ where: { id: flash.id }, data: { soldCount: GUEST_FLASH_QTY + 1 } });
      const dto = {
        items: [{ variationId: v.id, quantity: 1 }],
        customer: { recipient: 'Khách của CTV', phone: randomPhone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT', provinceCode: '84_VN01', wardCode: '00001' },
        paymentMethod: 'COD' as const,
      };

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${p.guest.id} FOR UPDATE`);
      const s = await race(holder, merge(p), () => affiliate.placeOrderForCustomer(p.target.id, dto));
      expectNoErrors(s);

      await expectMerged(p);
      const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: flash.id } });
      expect(purchases.map((x) => [x.userId, x.quantity])).toEqual([[p.target.id, GUEST_FLASH_QTY + 2]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(GUEST_FLASH_QTY + 2);
    }
  });

  /**
   * Như ca trên nhưng đơn hộ có thêm một dòng giờ vàng ĐỨNG TRƯỚC mà T chưa có dòng suất: dòng đó không được khoá users của T
   * trước khi dòng sau khoá xong dòng suất (gộp giữ dòng suất đó rồi chờ users của T).
   */
  it(`(b) đơn hộ [x chưa có dòng suất, v đích đã có dòng suất] ‖ gộp đã khoá dòng suất v → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const tag = randCode(10).toLowerCase();
      const p = await pair({ guest: `itr13-a-${tag}`, target: `itr13-b-${tag}` });
      await prisma.user.update({ where: { id: p.target.id }, data: { role: 'AFFILIATE', phone: randomPhone() } });
      const x = await variation();
      const v = await variation();
      const flashX = await flashItem(x);
      const flash = await flashWithGuestPurchase(v, p.guest.id);
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: p.target.id, quantity: 1 } });
      await prisma.flashSaleItem.update({ where: { id: flash.id }, data: { soldCount: GUEST_FLASH_QTY + 1 } });
      const dto = {
        items: [
          { variationId: x.id, quantity: 1 },
          { variationId: v.id, quantity: 1 },
        ],
        customer: { recipient: 'Khách của CTV', phone: randomPhone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT', provinceCode: '84_VN01', wardCode: '00001' },
        paymentMethod: 'COD' as const,
      };

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${p.guest.id} FOR UPDATE`);
      const s = await race(holder, merge(p), () => affiliate.placeOrderForCustomer(p.target.id, dto));
      expectNoErrors(s);

      await expectMerged(p);
      const placed = await prisma.order.findMany({ where: { userId: p.target.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.flashSaleItemId).sort())).toEqual([[flashX.id, flash.id].sort()]);
      const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: { in: [flash.id, flashX.id] } } });
      expect(new Map(purchases.map((q) => [`${q.flashSaleItemId}:${q.userId}`, q.quantity]))).toEqual(
        new Map([
          [`${flash.id}:${p.target.id}`, GUEST_FLASH_QTY + 2],
          [`${flashX.id}:${p.target.id}`, 1],
        ]),
      );
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flash.id } })).soldCount).toBe(GUEST_FLASH_QTY + 2);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: flashX.id } })).soldCount).toBe(1);
    }
  });

  it(`(c) khách G đặt đơn (đã khoá giỏ của G) ‖ gộp G vào T → không 40P01, đơn sang T (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      const v = await variation();
      await cart.addItem(p.guest.id, { variationId: v.id, quantity: 1 });

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${v.id} FOR UPDATE`);
      const s = await race(holder, place(p.guest.id, p.guestAddr.id), merge(p));
      expectNoErrors(s);

      await expectMerged(p);
      expect(await prisma.order.count({ where: { userId: p.guest.id } })).toBe(0);
      expect(await prisma.order.count({ where: { userId: p.target.id } })).toBe(1);
      expect(await prisma.cart.count({ where: { userId: p.guest.id } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(STOCK - 1);
    }
  });

  it(`(c) T đặt đơn (đã khoá giỏ của T) ‖ gộp khách có giỏ vào T → không 40P01, giỏ khách sang T (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      const v = await variation();
      const w = await variation();
      await cart.addItem(p.target.id, { variationId: v.id, quantity: 1 });
      await cart.addItem(p.guest.id, { variationId: w.id, quantity: 2 });
      // Trùng biến thể với dòng T đang đặt: gộp cộng dồn vào chính dòng đó; không chờ giỏ của T thì T dọn dòng đó theo id ⇒ mất 3.
      await cart.addItem(p.guest.id, { variationId: v.id, quantity: 3 });

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${v.id} FOR UPDATE`);
      const s = await race(holder, place(p.target.id, p.targetAddr.id), merge(p));
      expectNoErrors(s);

      await expectMerged(p);
      const placed = await prisma.order.findMany({ where: { userId: p.target.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => [i.variationId, i.quantity]))).toEqual([[[v.id, 1]]]);
      const after = await prisma.cartItem.findMany({ where: { cart: { userId: p.target.id } } });
      expect(new Map(after.map((i) => [i.variationId, i.quantity]))).toEqual(
        new Map([
          [v.id, 3],
          [w.id, 2],
        ]),
      );
    }
  });

  it(`(c) gộp khách có giỏ giữ users của T trước ‖ T đặt đơn → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const p = await pair();
      const v = await variation();
      const w = await variation();
      await cart.addItem(p.target.id, { variationId: v.id, quantity: 1 });
      await cart.addItem(p.guest.id, { variationId: w.id, quantity: 2 });

      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${p.guestAddr.id} FOR UPDATE`);
      const s = await race(holder, merge(p), place(p.target.id, p.targetAddr.id));
      expectNoErrors(s);

      await expectMerged(p);
      const placed = await prisma.order.findMany({ where: { userId: p.target.id }, include: { items: true } });
      expect(placed.map((o) => o.items.map((i) => i.variationId))).toEqual([[v.id]]);
      const after = await prisma.cartItem.findMany({ where: { cart: { userId: p.target.id } } });
      expect(after.map((i) => [i.variationId, i.quantity])).toEqual([[w.id, 2]]);
    }
  });
});
