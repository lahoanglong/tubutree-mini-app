import type { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { unlinkTubuFulfilledVariation } from '../../src/modules/merchant/merchant-pancake-link';
import { createOrder, createUser, randCode, setConfig, sleep, warmPool } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Hoa hồng CTV trên hàng ký gửi của chính đại lý và bảng kê trả tiền phải cùng một kết luận cho mỗi dòng: hoặc hoa hồng bị loại
 * VÀ bảng kê trả đại lý, hoặc hoa hồng được trả VÀ bảng kê không trả (không bao giờ cùng không, cũng không cùng có).
 * Checkout giữ khoá biến thể tới commit rồi mới chèn đơn và tính hoa hồng; gỡ liên kết / xác nhận ký gửi phải lấy mốc thời gian
 * SAU khi giành được khoá biến thể đó.
 */
describe('Hoa hồng CTV hàng ký gửi của chính mình ‖ gỡ liên kết / xác nhận ký gửi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let settlement: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantFulfilmentService,
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
    affiliate = moduleRef.get(AffiliateService);
    settlement = moduleRef.get(MerchantFulfilmentService);
    await setConfig(prisma, 'merchant.settlement_hold_days', 1);
  });
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: 'merchant.consignment_settle_from' } });
    await moduleRef?.close();
  });

  async function product(storefrontId: string | null) {
    const tag = randCode(8);
    return prisma.product.create({
      data: { pancakeId: `lk-p-${tag}`, brand: 'IT', slug: `lk-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000, storefrontId },
    });
  }
  async function setup(takeover = false) {
    const dealer = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({ data: { type: 'CTV', isPartner: true, slug: `lk-${tag}`, ownerUserId: dealer.id, title: `S ${tag}` } });
    const origin = await product(null);
    const own = await product(store.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `lk-v-${tag}`, productId: own.id, sku: `LK-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 50 },
    });
    const l = await prisma.merchantPancakeLink.create({
      data: { productId: own.id, storefrontId: store.id, variationId: v.id, originProductId: origin.id, takeover, linkedAt: new Date(Date.now() - 2 * HOUR) },
    });
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    return { dealer, store, own, v, l, buyer };
  }
  type S = Awaited<ReturnType<typeof setup>>;
  const orderData = (s: S) => ({
    userId: s.buyer.id,
    referrerUserId: s.dealer.id,
    fulfiller: 'TUBU' as const,
    status: 'DELIVERED' as const,
    deliveredAt: new Date(Date.now() - 20 * DAY),
    subtotal: 100_000,
    total: 100_000,
    items: { create: [{ variationId: s.v.id, productName: 'Own', variationName: 'M', unitPrice: 100_000, quantity: 1, total: 100_000, paidTotal: 100_000 }] },
  });
  async function ledgerHas(storeId: string, orderId: string) {
    const st = await settlement.statementFor(storeId, new Date(Date.now() + 30 * DAY));
    return ([...st.lines, ...st.upcoming] as { orderId?: string }[]).some((l) => l.orderId === orderId);
  }

  const blockedBy = async (pid: number) => {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids("pid"))`;
    return Number(n);
  };
  /** Chờ tới khi điều kiện đúng; `soft`: hết hạn thì thôi (mã cũ không chờ nên không bao giờ bị chặn). */
  async function until(cond: () => Promise<boolean>, label: string, soft = false) {
    for (let i = 0; i < (soft ? 60 : 400); i++) {
      if (await cond()) return;
      await sleep(25);
    }
    if (!soft) throw new Error(`hết giờ chờ: ${label}`);
  }

  /** Tx làm một việc (giữ khoá) rồi đứng chờ `release`. */
  async function hold(work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let pid = 0;
    let ready!: () => void;
    const readyP = new Promise<void>((r) => (ready = r));
    const done = prisma.$transaction(
      async (tx) => {
        pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        await work(tx);
        ready();
        await gate;
      },
      { timeout: 30_000 },
    );
    done.catch(() => ready());
    await readyP;
    return { release, done, pid: () => pid };
  }

  /** Checkout giả lập: giữ kho biến thể (khoá), chờ `beforeInsert`, chèn đơn, tính hoa hồng, commit. */
  function checkout(s: S, beforeInsert: (pid: number) => Promise<void> = async () => {}) {
    let locked!: (pid: number) => void;
    const lockedP = new Promise<number>((r) => (locked = r));
    const done = prisma.$transaction(
      async (tx) => {
        const pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        await tx.$executeRaw`UPDATE "variations" SET "stock" = "stock" - 1, "reservedStock" = "reservedStock" + 1 WHERE "id" = ${s.v.id}`;
        locked(pid);
        await beforeInsert(pid);
        const o = await tx.order.create({
          data: { code: `LK${randCode(8)}`, type: 'RETAIL', paymentMethod: 'COD', paymentStatus: 'UNPAID', shippingAddress: {}, deliveredEffectsAt: new Date(), ...orderData(s) },
        });
        await affiliate.createCommissionForOrder(o.id, tx);
        return o;
      },
      { timeout: 30_000 },
    );
    return { done, locked: lockedP };
  }

  /** Không lỗi nào (kể cả 40P01), và hoa hồng bị loại <=> bảng kê trả đại lý. */
  async function outcome(s: S, results: PromiseSettledResult<unknown>[], orderId: string) {
    for (const r of results) {
      if (r.status === 'rejected') throw r.reason;
    }
    const commissionZero = (await prisma.commission.count({ where: { orderId } })) === 0;
    const ledgerPays = await ledgerHas(s.store.id, orderId);
    expect(commissionZero).toBe(ledgerPays);
    return { commissionZero, ledgerPays };
  }
  const orderOf = (r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') throw r.reason;
    return (r as PromiseFulfilledResult<{ id: string }>).value;
  };

  it('settleFrom ở tương lai + hàng ký gửi liên kết của chính đại lý qua kênh riêng: hoa hồng CTV vẫn bị loại (đơn trước mốc chốt tay, không trả hai lần)', async () => {
    await setConfig(prisma, 'merchant.consignment_settle_from', new Date(Date.now() + DAY).toISOString());
    try {
      const s = await setup();
      const o = await createOrder(prisma, orderData(s));
      await affiliate.createCommissionForOrder(o.id);
      expect(await prisma.commission.count({ where: { orderId: o.id } })).toBe(0);
      expect(await ledgerHas(s.store.id, o.id)).toBe(false);
    } finally {
      await prisma.systemConfig.deleteMany({ where: { key: 'merchant.consignment_settle_from' } });
    }
  });

  describe.each([1, 2, 3])('vòng %i', () => {
    it('gỡ liên kết ‖ checkout đang giữ khoá biến thể: hoa hồng bị loại VÀ bảng kê trả (không cùng không)', async () => {
      const s = await setup();
      let unlinkBlocked = false;
      const co = checkout(s, async (pid) => {
        await until(async () => (unlinkBlocked = (await blockedBy(pid)) >= 1), 'gỡ liên kết bị chặn', true);
      });
      await co.locked;
      const unlink = prisma.$transaction((tx) => unlinkTubuFulfilledVariation(tx, s.own.id, { actorId: 'lk', reason: 'test', deactivate: false }), { timeout: 30_000 });
      const results = await Promise.allSettled([co.done, unlink]);
      expect(unlinkBlocked).toBe(true);
      const r = await outcome(s, results, orderOf(results[0]!).id);
      expect(r).toEqual({ commissionZero: true, ledgerPays: true });
    });

    it('checkout ‖ gỡ liên kết đã giữ khoá biến thể: hoa hồng được trả VÀ bảng kê không trả', async () => {
      const s = await setup();
      const un = await hold(async (tx) => {
        await unlinkTubuFulfilledVariation(tx, s.own.id, { actorId: 'lk', reason: 'test', deactivate: false });
      });
      const co = checkout(s);
      await until(async () => (await blockedBy(un.pid())) >= 1, 'checkout bị chặn bởi gỡ liên kết');
      un.release();
      const results = await Promise.allSettled([co.done, un.done]);
      const r = await outcome(s, results, orderOf(results[0]!).id);
      expect(r).toEqual({ commissionZero: false, ledgerPays: false });
    });

    it('xác nhận ký gửi (takeover) ‖ checkout đang giữ khoá biến thể: hoa hồng được trả VÀ bảng kê không trả đơn đặt trước mốc', async () => {
      const s = await setup(true);
      let confirmBlocked = false;
      const co = checkout(s, async (pid) => {
        await until(async () => (confirmBlocked = (await blockedBy(pid)) >= 1), 'xác nhận bị chặn', true);
      });
      await co.locked;
      const confirm = settlement.confirmConsignment('admin-lk', s.l.id);
      const results = await Promise.allSettled([co.done, confirm]);
      expect(confirmBlocked).toBe(true);
      const r = await outcome(s, results, orderOf(results[0]!).id);
      expect(r).toEqual({ commissionZero: false, ledgerPays: false });
    });

    it('xác nhận ký gửi (takeover) bị kẹt ở dòng liên kết ‖ checkout chèn đơn giữa chừng: không trả hai lần', async () => {
      const s = await setup(true);
      const linkRow = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "merchant_pancake_links" WHERE "id" = ${s.l.id} FOR UPDATE`);
      const confirm = settlement.confirmConsignment('admin-lk', s.l.id);
      confirm.catch(() => undefined);
      await until(async () => (await blockedBy(linkRow.pid())) >= 1, 'xác nhận bị chặn ở dòng liên kết');
      const co = checkout(s);
      await sleep(700);
      linkRow.release();
      const results = await Promise.allSettled([co.done, confirm, linkRow.done]);
      await outcome(s, results, orderOf(results[0]!).id);
    });
  });
});
