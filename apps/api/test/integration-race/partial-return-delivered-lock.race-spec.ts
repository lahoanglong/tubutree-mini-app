import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const UNIT = 50_000;
const EARNED = 30;

/**
 * R6-CHECKOUT-1/2: duyệt trả một phần đơn A giữ FOR NO KEY UPDATE trên dòng users của khách (đã UPDATE số dư/Ví) rồi, trước fix,
 * đọc số dư bằng FOR UPDATE. Hai kiểu tx khác của CÙNG khách làm nó deadlock (40P01):
 *  (a) giao đơn B: chèn dòng sổ điểm (KEY SHARE do FK, đụng FOR UPDATE) rồi chờ NO KEY UPDATE của duyệt;
 *  (b) khách tự huỷ đơn trả bằng Ví: không giữ KEY SHARE nào, chỉ xếp hàng chờ NO KEY UPDATE (wallet-ledger) trước; duyệt nâng
 *      lên FOR UPDATE thì phải xếp hàng sau nó ⇒ chờ nhau.
 * Tx thứ ba giữ KEY SHARE trên dòng user để ép thứ tự: duyệt lấy NKU rồi kẹt ở bước đọc số dư, tx kia vào hàng chờ, thả ra là chu trình.
 */
describe('Duyệt trả một phần ‖ tx khác của cùng khách trên dòng users (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let returns: OrderReturnsService;
  let orders: OrdersService;
  let admin: { id: string };
  let savedConfig: { key: string; value: unknown }[] = [];

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
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    returns = moduleRef.get(OrderReturnsService);
    orders = moduleRef.get(OrdersService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: 'returns.window_days' } });
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    if (prisma) {
      if (savedConfig.length === 0) await prisma.systemConfig.deleteMany({ where: { key: 'returns.window_days' } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-prdl-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
  }

  async function orderWithItem(userId: string, data: Partial<Prisma.OrderUncheckedCreateInput>, qty: number) {
    const v = await variation();
    const total = qty * UNIT;
    const order = await createOrder(prisma, {
      userId,
      subtotal: total,
      shippingFee: 0,
      total,
      ...data,
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: qty, total, paidTotal: total }],
      },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { ...order, item };
  }

  /** Đơn COD đã giao 3 × 50.000 đã cộng điểm ORDER_DELIVERED: duyệt trả 1 món hoàn Ví + thu hồi điểm tích (tới dòng đọc số dư). */
  async function deliveredEarnedOrder(userId: string) {
    const order = await orderWithItem(userId, { status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', pointsEarned: EARNED, deliveredAt: new Date() }, 3);
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: EARNED, lot: 'STANDARD', reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, expiresAt: new Date(Date.now() + 365 * 864e5) },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: EARNED } } }),
    ]);
    return order;
  }

  async function requestPartial(userId: string, order: Awaited<ReturnType<typeof deliveredEarnedOrder>>) {
    const req = await returns.request(userId, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: order.item.id, quantity: 1 }],
    });
    return req.id;
  }

  async function holdUserKeyShare(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR KEY SHARE`;
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
   * Duyệt lấy NKU rồi (trước fix) chờ ở bước đọc số dư vì tx thứ ba giữ KEY SHARE; sau fix nó không bị chặn và xong hẳn.
   * Chỉ sau đó mới khởi động `other` để nó lấy KEY SHARE của chính nó trong lúc duyệt còn giữ NKU, rồi thả khoá.
   */
  async function raceApproveWith(userId: string, requestId: string, start: () => Promise<unknown>) {
    const hold = await holdUserKeyShare(userId);
    let approveSettled = false;
    const approve = returns.review(admin.id, requestId, { approve: true }).finally(() => (approveSettled = true));
    await waitUntil(async () => approveSettled || (await lockWaiters(hold.pid)) >= 1, 'duyệt trả');
    let otherSettled = false;
    const other = start().finally(() => (otherSettled = true));
    await waitUntil(async () => otherSettled || (await lockWaiters(hold.pid)) >= (approveSettled ? 1 : 2), 'tx cùng khách');
    hold.release();
    await hold.done;
    return summarize(await Promise.allSettled([approve, other]));
  }

  async function ledgerInvariants(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, walletBalance: true } });
    const points = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    const wallet = await prisma.walletTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(points._sum.delta ?? 0);
    expect(u.walletBalance).toBe(wallet._sum.delta ?? 0);
    return u;
  }

  it('(a) duyệt trả một phần đơn A ‖ giao đơn B của cùng khách → không 40P01, điểm B cộng đúng 1 lần, A có dòng thu hồi', async () => {
    for (let round = 0; round < 3; round++) {
      const user = await createUser(prisma, { role: 'CUSTOMER' });
      const a = await deliveredEarnedOrder(user.id);
      const b = await orderWithItem(user.id, { status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', pointsEarned: EARNED }, 1);
      const reqId = await requestPartial(user.id, a);

      const s = await raceApproveWith(user.id, reqId, () => orderStatus.setStatus(b.id, 'DELIVERED'));
      expect(s.errors).toEqual([]);

      expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: `ORDER_DELIVERED:${b.code}` } })).toBe(1);
      expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: `RETURN_REVERSED:${a.code}`, refId: reqId } })).toBe(1);
      expect(await prisma.walletTransaction.count({ where: { userId: user.id, type: 'ORDER_REFUND', refId: reqId } })).toBe(1);
      const u = await ledgerInvariants(user.id);
      expect(u.walletBalance).toBe(UNIT);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('DELIVERED');
    }
  });

  it('(b) duyệt trả một phần đơn A ‖ khách tự huỷ đơn B trả bằng Ví → không 40P01, hoàn Ví đúng 1 lần, số dư khớp sổ', async () => {
    for (let round = 0; round < 3; round++) {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const a = await deliveredEarnedOrder(user.id);
      const c = await orderWithItem(user.id, { status: 'CONFIRMED', paymentMethod: 'WALLET', paymentStatus: 'PAID' }, 1);
      await prisma.walletTransaction.create({ data: { userId: user.id, delta: UNIT, balanceAfter: UNIT, type: 'OPENING', refType: 'IT', refId: c.id } });
      await prisma.user.update({ where: { id: user.id }, data: { walletBalance: UNIT } });
      const reqId = await requestPartial(user.id, a);

      const s = await raceApproveWith(user.id, reqId, () => orders.cancel(user.id, c.code));
      expect(s.errors).toEqual([]);

      expect((await prisma.order.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('CANCELLED');
      expect(await prisma.walletTransaction.count({ where: { userId: user.id, type: 'ORDER_REFUND', refId: c.id } })).toBe(1);
      expect(await prisma.walletTransaction.count({ where: { userId: user.id, type: 'ORDER_REFUND', refId: reqId } })).toBe(1);
      expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: `RETURN_REVERSED:${a.code}`, refId: reqId } })).toBe(1);
      const u = await ledgerInvariants(user.id);
      expect(u.walletBalance).toBe(UNIT + UNIT + UNIT);
    }
  });
});
