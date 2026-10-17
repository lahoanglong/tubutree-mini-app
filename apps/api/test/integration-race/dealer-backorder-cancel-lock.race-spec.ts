import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { DealerBackorderService } from '../../src/modules/dealer/dealer-backorder.service';
import { createDealer, createOrder, deleteItData, randCode, sleep, summarize, warmPool } from './helpers';

const PRICE = 50_000;
const ROUNDS = 5;

/**
 * Cron lấp hàng đặt trước khoá biến thể (giữ kho) rồi mới ghi `backorderedQty` của dòng hàng; huỷ đơn đại lý khoá dòng hàng
 * (đọc lại backorderedQty, FOR UPDATE) rồi mới trả kho biến thể ⇒ hai tx chờ nhau (40P01). Tx thứ ba giữ FOR UPDATE dòng biến thể
 * để ép thứ tự: cron chạy trước và xếp hàng ở biến thể, huỷ đơn tới sau cũng xếp hàng; thả ra thì cron lấy biến thể trước.
 * Cron nuốt lỗi (log rồi trả 0) nên kiểm cả log lỗi của nó.
 */
describe('Cron lấp hàng đặt trước ‖ huỷ đơn đại lý cùng dòng hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let backorder: DealerBackorderService;
  const created = { userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        DealerBackorderService,
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
    backorder = moduleRef.get(DealerBackorderService);
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await moduleRef?.close();
  });

  /** Đơn đại lý 3 đơn vị, giữ được 1 lúc đặt (2 đặt trước); kho còn 5 (Pancake 6, giữ chỗ 1). */
  async function scenario() {
    const dealer = await createDealer(prisma);
    created.userIds.push(dealer.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itbo-p-${tag}`, brand: 'IT', slug: `itbo-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itbo-v-${tag}`,
        productId: product.id,
        sku: `ITBO-${tag}`,
        name: 'Chai',
        attributes: {},
        retailPrice: PRICE,
        stock: 5,
        reservedStock: 1,
        pancakeStock: 6,
      },
    });
    const order = await createOrder(prisma, {
      userId: dealer.id,
      type: 'DEALER',
      status: 'CONFIRMED',
      // Cron lấy 200 dòng đặt trước cũ nhất của cả DB dùng chung: đơn của ca này phải đứng đầu lô.
      createdAt: new Date('2000-01-01T00:00:00Z'),
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      subtotal: 3 * PRICE,
      total: 3 * PRICE,
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: PRICE, quantity: 3, total: 3 * PRICE, backorderedQty: 2 }],
      },
    });
    return { order, variation: v };
  }

  async function holdVariation(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${id} FOR UPDATE`;
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

  it(`cron lấp hàng ‖ huỷ đơn đại lý → không 40P01, kho về đúng số Pancake (${ROUNDS} vòng)`, async () => {
    const cronErrors = jest.spyOn(Logger.prototype, 'error');
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const s = await scenario();
        cronErrors.mockClear();
        const hold = await holdVariation(s.variation.id);
        let cronSettled = false;
        const cron = backorder.reconcile().finally(() => (cronSettled = true));
        await waitUntil(async () => cronSettled || (await lockWaiters(hold.pid)) >= 1, 'cron lấp hàng');
        // Không xanh giả: cron phải thật sự xếp hàng ở biến thể của ca này (không phải chạy xong mà không chọn dòng của ca).
        expect(cronSettled).toBe(false);
        let cancelSettled = false;
        const cancel = orderStatus.setStatus(s.order.id, 'CANCELLED').finally(() => (cancelSettled = true));
        await waitUntil(async () => cancelSettled || (await lockWaiters(hold.pid)) >= (cronSettled ? 1 : 2), 'huỷ đơn');
        hold.release();
        await hold.done;
        const r = summarize(await Promise.allSettled([cron, cancel]));
        // Cron giữ được biến thể trước lần huỷ (đứng đầu hàng) nên lấp đủ 2 đơn vị đặt trước của ca này.
        expect(r.fulfilled[0]?.value).toBeGreaterThanOrEqual(2);
        const loggedErrors = cronErrors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Đối soát đặt trước lỗi'));
        expect(r.errors.filter((e) => e.includes('40P01'))).toEqual([]);
        expect(loggedErrors).toEqual([]);
        expect(r.errors).toEqual([]);

        expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('CANCELLED');
        const v = await prisma.variation.findUniqueOrThrow({ where: { id: s.variation.id } });
        expect([v.stock, v.reservedStock]).toEqual([6, 0]);
        expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: s.order.id } })).backorderedQty).toBe(0);
      }
    } finally {
      cronErrors.mockRestore();
    }
  });
});
