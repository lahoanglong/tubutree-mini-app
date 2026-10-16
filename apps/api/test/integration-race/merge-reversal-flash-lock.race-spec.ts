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
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 50_000;
const ROUNDS = 5;
const GUEST_QTY = 1;
const TARGET_QTY = 3;

/**
 * Đảo tiền (huỷ đơn / duyệt trả một phần) hoàn suất giờ vàng của chủ đơn (dòng flash_sale_purchases) rồi mới ghi dòng users.
 * Gộp phiên khách vào chính chủ đơn đó cộng dồn suất đã mua vào dòng flash_sale_purchases của tài khoản đích; nếu gộp khoá
 * users trước rồi mới ghi dòng suất thì hai tx chờ nhau (40P01). Tx thứ ba giữ FOR UPDATE dòng suất của tài khoản đích để
 * ép thứ tự: lần đảo đã giữ đơn và đang chờ dòng suất, lần gộp tới sau cũng xếp hàng chờ; thả ra thì lần đảo lấy dòng suất trước.
 */
describe('Gộp phiên khách ‖ đảo tiền đơn có suất giờ vàng của tài khoản đích (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let returns: OrderReturnsService;
  let auth: AuthService;
  let admin: { id: string };
  let zaloIdForNextCall = '';
  const CONFIG_KEYS = ['returns.window_days'];
  let savedConfig: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        OrdersService,
        FlashSaleService,
        { provide: CartService, useValue: {} },
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    returns = moduleRef.get(OrderReturnsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
    created.userIds.push(admin.id);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-f2', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    if (prisma) {
      await deleteItData(prisma, created);
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  /** Khách G và tài khoản đích T cùng đã mua suất F; T có đơn `order` chứa 1 suất F. */
  async function scenario(order: { status: 'CONFIRMED' | 'DELIVERED'; quantity: number }) {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}` });
    const target = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}` });
    created.userIds.push(guest.id, target.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itmf-p-${tag}`, brand: 'IT', slug: `itmf-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `itmf-v-${tag}`, productId: product.id, sku: `ITMF-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(sale.id);
    const flash = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: v.id, flashPrice: PRICE, quota: 100, soldCount: GUEST_QTY + TARGET_QTY, perUserLimit: 10 },
    });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: guest.id, quantity: GUEST_QTY } });
    const targetPurchase = await prisma.flashSalePurchase.create({ data: { flashSaleItemId: flash.id, userId: target.id, quantity: TARGET_QTY } });
    const total = order.quantity * PRICE;
    const delivered = order.status === 'DELIVERED';
    const o = await createOrder(prisma, {
      userId: target.id,
      status: order.status,
      paymentMethod: delivered ? 'COD' : 'WALLET',
      paymentStatus: delivered ? 'UNPAID' : 'PAID',
      deliveredAt: delivered ? new Date() : undefined,
      subtotal: total,
      shippingFee: 0,
      total,
      items: {
        create: [
          { variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: PRICE, quantity: order.quantity, total, paidTotal: total, flashSaleItemId: flash.id },
        ],
      },
    });
    if (!delivered) {
      await prisma.walletTransaction.create({ data: { userId: target.id, delta: total, balanceAfter: total, type: 'OPENING', refType: 'IT', refId: o.id } });
      await prisma.user.update({ where: { id: target.id }, data: { walletBalance: total } });
    }
    return { guest, target, order: o, flash, targetPurchase };
  }

  async function holdRow(purchaseId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "flash_sale_purchases" WHERE "id" = ${purchaseId} FOR UPDATE`;
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

  /** Lần đảo chạy tới khi kẹt ở dòng suất đang bị giữ; rồi lần gộp chạy tới khi cũng kẹt (dòng suất hoặc users); thả khoá. */
  async function raceReversalWithMerge(s: Awaited<ReturnType<typeof scenario>>, reverse: () => Promise<unknown>) {
    const hold = await holdRow(s.targetPurchase.id);
    let reverseSettled = false;
    const reversing = reverse().finally(() => (reverseSettled = true));
    await waitUntil(async () => reverseSettled || (await lockWaiters(hold.pid)) >= 1, 'lần đảo');
    let mergeSettled = false;
    zaloIdForNextCall = s.target.zaloId!;
    const merging = auth.ensurePhoneForCurrentUser(s.guest.id, 'code', 'access').finally(() => (mergeSettled = true));
    await waitUntil(async () => mergeSettled || (await lockWaiters(hold.pid)) >= (reverseSettled ? 1 : 2), 'lần gộp');
    hold.release();
    await hold.done;
    return summarize(await Promise.allSettled([reversing, merging]));
  }

  /** Gộp là nạn nhân deadlock thì AuthService đổi 40P01 thành 503 "đang bận" (isMergeBusy): cũng là vòng khoá. */
  function expectNoErrors(s: { errors: string[] }) {
    expect(s.errors.filter((e) => e.includes('40P01') || e.includes('đang bận'))).toEqual([]);
    expect(s.errors).toEqual([]);
  }

  async function afterMerge(s: Awaited<ReturnType<typeof scenario>>, restored: number) {
    const purchases = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: s.flash.id } });
    expect(purchases.map((p) => [p.userId, p.quantity])).toEqual([[s.target.id, GUEST_QTY + TARGET_QTY - restored]]);
    expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: s.flash.id } })).soldCount).toBe(GUEST_QTY + TARGET_QTY - restored);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.guest.id } })).zaloId).toContain('_merged_');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.target.id }, select: { walletBalance: true, pointsBalance: true } });
    const wallet = await prisma.walletTransaction.aggregate({ where: { userId: s.target.id }, _sum: { delta: true } });
    const points = await prisma.pointsTransaction.aggregate({ where: { userId: s.target.id, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.walletBalance).toBe(wallet._sum.delta ?? 0);
    expect(u.pointsBalance).toBe(points._sum.delta ?? 0);
    return u;
  }

  it(`(a) huỷ đơn trả Ví có suất giờ vàng ‖ gộp phiên khách vào chủ đơn → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario({ status: 'CONFIRMED', quantity: 1 });
      const r = await raceReversalWithMerge(s, () => orders.cancel(s.target.id, s.order.code));
      expectNoErrors(r);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('CANCELLED');
      const u = await afterMerge(s, 1);
      expect(u.walletBalance).toBe(2 * PRICE);
    }
  });

  /**
   * Khách G không có suất nào; T có 2 dòng suất (A id nhỏ, B id lớn) và một đơn trả Ví mà dòng B đứng trước dòng A. Huỷ đơn hoàn
   * suất theo thứ tự dòng đơn (B rồi A); gộp mà khoá MỌI dòng suất của T theo id (A rồi B) là chờ ngược chiều. Tx thứ ba giữ FOR
   * UPDATE biến thể A: lần huỷ đã hoàn xong dòng B và kẹt ở kho A; gộp tới sau.
   */
  it(`(c) khách không có suất ‖ huỷ đơn của đích có 2 dòng giờ vàng ngược thứ tự id → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}` });
      const target = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}` });
      created.userIds.push(guest.id, target.id);
      const tag = randCode(8).toLowerCase();
      const now = Date.now();
      const sale = await prisma.flashSale.create({
        data: { title: `Giờ vàng ${tag}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
      });
      created.flashSaleIds.push(sale.id);
      const lines: { key: 'a' | 'b'; variationId: string; flashId: string; purchaseId: string }[] = [];
      for (const key of ['a', 'b'] as const) {
        const product = await prisma.product.create({
          data: { pancakeId: `itmf-p-${tag}${key}`, brand: 'IT', slug: `itmf-sp-${tag}${key}`, name: `SP ${tag}${key}`, description: 'IT', basePrice: PRICE },
        });
        created.productIds.push(product.id);
        const v = await prisma.variation.create({
          data: { pancakeId: `itmf-v-${tag}${key}`, productId: product.id, sku: `ITMF-${tag}${key}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
        });
        const flash = await prisma.flashSaleItem.create({
          data: { flashSaleId: sale.id, variationId: v.id, flashPrice: PRICE, quota: 100, soldCount: TARGET_QTY, perUserLimit: 10 },
        });
        const p = await prisma.flashSalePurchase.create({
          data: { id: `itfsp-${tag}-${key}`, flashSaleItemId: flash.id, userId: target.id, quantity: TARGET_QTY },
        });
        lines.push({ key, variationId: v.id, flashId: flash.id, purchaseId: p.id });
      }
      const [a, b] = lines as [(typeof lines)[0], (typeof lines)[0]];
      const order = await createOrder(prisma, {
        userId: target.id,
        status: 'CONFIRMED',
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        subtotal: 2 * PRICE,
        shippingFee: 0,
        total: 2 * PRICE,
        items: {
          create: [b, a].map((l, i) => ({
            id: `itoi-${tag}-${i}`,
            variationId: l.variationId,
            productName: 'Nước giặt',
            variationName: 'Chai',
            unitPrice: PRICE,
            quantity: 1,
            total: PRICE,
            paidTotal: PRICE,
            flashSaleItemId: l.flashId,
          })),
        },
      });
      await prisma.walletTransaction.create({ data: { userId: target.id, delta: 2 * PRICE, balanceAfter: 2 * PRICE, type: 'OPENING', refType: 'IT', refId: order.id } });
      await prisma.user.update({ where: { id: target.id }, data: { walletBalance: 2 * PRICE } });

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const held = new Promise<void>((resolve) => (locked = resolve));
      let pid = 0;
      const hold = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${a.variationId} FOR UPDATE`;
          [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
          locked();
          await gate;
        },
        { timeout: 30_000 },
      );
      await held;
      let cancelSettled = false;
      const cancelling = orders.cancel(target.id, order.code).finally(() => (cancelSettled = true));
      await waitUntil(async () => cancelSettled || (await lockWaiters(pid)) >= 1, 'huỷ đơn');
      let mergeSettled = false;
      zaloIdForNextCall = target.zaloId!;
      const merging = auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access').finally(() => (mergeSettled = true));
      await waitUntil(async () => mergeSettled || (await lockWaiters(pid)) >= (cancelSettled ? 1 : 2), 'lần gộp');
      release();
      await hold;
      const r = summarize(await Promise.allSettled([cancelling, merging]));
      expectNoErrors(r);

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
      const purchases = await prisma.flashSalePurchase.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } });
      expect(purchases.map((p) => [p.id, p.quantity])).toEqual([
        [a.purchaseId, TARGET_QTY - 1],
        [b.purchaseId, TARGET_QTY - 1],
      ]);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).zaloId).toContain('_merged_');
      const u = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { walletBalance: true } });
      const wallet = await prisma.walletTransaction.aggregate({ where: { userId: target.id }, _sum: { delta: true } });
      expect(u.walletBalance).toBe(wallet._sum.delta ?? 0);
      expect(u.walletBalance).toBe(4 * PRICE);
    }
  });

  it(`(b) duyệt trả một phần đơn có suất giờ vàng ‖ gộp phiên khách vào chủ đơn → không 40P01 (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario({ status: 'DELIVERED', quantity: 2 });
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: s.order.id } });
      const req = await returns.request(s.target.id, s.order.code, {
        reasonCode: 'OTHER',
        reason: 'Không còn nhu cầu dùng nữa',
        items: [{ orderItemId: item.id, quantity: 1 }],
      });
      const r = await raceReversalWithMerge(s, () => returns.review(admin.id, req.id, { approve: true }));
      expectNoErrors(r);
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');
      const u = await afterMerge(s, 1);
      expect(u.walletBalance).toBe(PRICE);
    }
  });
});
