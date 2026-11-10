import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const UNIT = 50_000;
const ALREADY = 'BadRequestException: Đơn đang có yêu cầu đổi/trả chờ xử lý.';

/**
 * `OrderReturnsService.request` đọc trạng thái đơn, hạn đổi/trả, yêu cầu đang chờ và phần đã trả rồi mới ghi; trước đây các lần đọc nằm ngoài
 * transaction và không khoá đơn, nên webhook trả/huỷ hay lần duyệt xen giữa vẫn để lại một yêu cầu REQUESTED trên đơn đã RETURNED (không duyệt
 * được nữa). Giờ `request` khoá dòng đơn (`FOR UPDATE`, cùng khoá `review`/`receive`/webhook dùng) rồi đọc và ghi trong một tx. `receive` đọc lại
 * dòng của yêu cầu trong tx sau khoá đơn thay vì dùng bản đọc từ trước.
 */
describe('Đổi/trả: request và receive khoá đơn, đọc dòng trong tx (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let admin: { id: string };
  let savedConfig: { key: string; value: unknown }[] = [];
  const userIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            alertPaidCommissionOfReversedOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: 'returns.window_days' } });
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
    userIds.push(admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      if (savedConfig.length === 0) await prisma.systemConfig.deleteMany({ where: { key: 'returns.window_days' } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
      await deleteItData(prisma, { userIds, productIds });
    }
    await moduleRef?.close();
  });

  async function customer() {
    const u = await createUser(prisma);
    userIds.push(u.id);
    return u;
  }

  async function deliveredOrder(userId: string, qty = 3, data: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-orl-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    productIds.push(product.id);
    const variation = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
    const total = qty * UNIT;
    const order = await createOrder(prisma, {
      userId,
      subtotal: total,
      shippingFee: 0,
      total,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      deliveredAt: new Date(),
      ...data,
      items: { create: [{ variationId: variation.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: qty, total, paidTotal: total }] },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, item, variation };
  }

  const askReturn = (userId: string, code: string, orderItemId: string, quantity: number) =>
    returns.request(userId, code, { reasonCode: 'OTHER', reason: 'Không còn nhu cầu dùng nữa', items: [{ orderItemId, quantity }] });

  /** Giữ `FOR UPDATE` dòng đơn tới khi thả; `beforeCommit` chạy trong chính tx đó ngay trước lúc thả (như webhook lật trạng thái). */
  async function holdOrder(orderId: string, beforeCommit?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
        await beforeCommit?.(tx);
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

  const requested = (orderId: string) => prisma.returnRequest.count({ where: { orderId, status: 'REQUESTED' } });

  it('request ‖ đơn bị lật sang RETURNED trong lúc khoá: request chờ khoá, thấy RETURNED, bị từ chối và không để lại yêu cầu REQUESTED nào', async () => {
    for (let round = 0; round < 3; round++) {
      const u = await customer();
      const { order, item } = await deliveredOrder(u.id);
      const hold = await holdOrder(order.id, (tx) => tx.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } }));
      let settled = false;
      const request = askReturn(u.id, order.code, item.id, 1).finally(() => (settled = true));
      await waitUntil(async () => settled || (await lockWaiters(hold.pid)) >= 1, 'request đổi/trả');
      hold.release();
      await hold.done;
      const s = summarize(await Promise.allSettled([request]));
      expect(s.fulfilled).toHaveLength(0);
      expect(s.errors).toEqual(['BadRequestException: Chỉ yêu cầu đổi/trả với đơn đã giao.']);
      expect(await requested(order.id)).toBe(0);
    }
  });

  it('request ‖ phần đã trả vừa được duyệt trong lúc khoá: request đọc số còn lại MỚI, đòi vượt số còn lại thì bị từ chối', async () => {
    const u = await customer();
    const { order, item } = await deliveredOrder(u.id, 3);
    const first = await askReturn(u.id, order.code, item.id, 2);
    // Duyệt `first` sau khi `request` đã xếp hàng chờ khoá: đúng chỗ bản cũ đọc phần đã trả ngoài khoá (còn 3) và cho đòi 3.
    const hold = await holdOrder(order.id, async (tx) => {
      await tx.returnRequest.update({ where: { id: first.id }, data: { status: 'APPROVED', reviewedBy: admin.id, reviewedAt: new Date() } });
    });
    let settled = false;
    const second = askReturn(u.id, order.code, item.id, 2).finally(() => (settled = true));
    await waitUntil(async () => settled || (await lockWaiters(hold.pid)) >= 1, 'request đổi/trả');
    hold.release();
    await hold.done;
    const s = summarize(await Promise.allSettled([second]));
    expect(s.fulfilled).toHaveLength(0);
    expect(s.errors[0]).toContain('vượt số còn lại có thể trả (1)');
    expect(await requested(order.id)).toBe(0);
  });

  it('6 request cùng đơn song song: đúng 1 yêu cầu REQUESTED, 5 bị báo đang có yêu cầu chờ, không lỗi nào khác', async () => {
    const u = await customer();
    const { order, item } = await deliveredOrder(u.id, 3);
    const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => askReturn(u.id, order.code, item.id, 1))));
    expect(s.fulfilled).toHaveLength(1);
    expect(s.errors).toEqual(Array(5).fill(ALREADY));
    expect(await requested(order.id)).toBe(1);
  });

  it('request của người khác với mã đơn không phải của họ: 404 và không xếp hàng chờ khoá đơn', async () => {
    const owner = await customer();
    const stranger = await customer();
    const { order, item } = await deliveredOrder(owner.id);
    const hold = await holdOrder(order.id);
    // Kẻ lạ bị chặn từ lần đọc chủ đơn, trước cả khi xếp hàng chờ khoá đơn: nếu không, ai cũng treo được request của chủ đơn bằng mã đơn.
    try {
      const attempt = Promise.allSettled([askReturn(stranger.id, order.code, item.id, 1)]);
      // Còn xếp hàng chờ khoá thì lời gọi không bao giờ xong khi khoá còn giữ: đua với một hạn ngắn để hỏng bằng lời rõ ràng thay vì treo tới hết giờ jest.
      const outcome = await Promise.race([attempt, sleep(3_000).then(() => 'xếp hàng chờ khoá đơn của người khác' as const)]);
      expect(outcome).not.toBe('xếp hàng chờ khoá đơn của người khác');
      expect(summarize(outcome as PromiseSettledResult<unknown>[]).errors).toEqual(['NotFoundException: Không tìm thấy đơn hàng.']);
      expect(await lockWaiters(hold.pid)).toBe(0);
    } finally {
      hold.release();
      await hold.done;
    }
  });

  describe('receive', () => {
    async function approvedRequest(qty: number, requestQty: number) {
      const u = await customer();
      const made = await deliveredOrder(u.id, qty);
      const req = await askReturn(u.id, made.order.code, made.item.id, requestQty);
      await returns.review(admin.id, req.id, { approve: true });
      return { ...made, req };
    }
    const stockOf = async (variationId: string) => (await prisma.variation.findUniqueOrThrow({ where: { id: variationId } })).stock;

    it('5 lần nhận hàng song song cùng một yêu cầu: đúng 1 lần thành công, kho cộng đúng 1 lần phần được trả', async () => {
      const { req, variation } = await approvedRequest(3, 2);
      const before = await stockOf(variation.id);
      const other = await createUser(prisma, { role: 'ADMIN' });
      userIds.push(other.id);
      const s = summarize(await Promise.allSettled(Array.from({ length: 5 }, (_, i) => returns.markReceived(i % 2 ? admin.id : other.id, req.id))));
      expect(s.fulfilled).toHaveLength(1);
      for (const e of s.errors) expect(e).toContain('đã ghi nhận nhận hàng trước đó');
      expect(await stockOf(variation.id)).toBe(before + 2);
    });

    it('dòng của yêu cầu đổi giữa lúc đọc và lúc khoá đơn: kho cộng theo dòng đọc trong tx (không theo bản đọc từ trước)', async () => {
      const { req, item, variation } = await approvedRequest(3, 2);
      const before = await stockOf(variation.id);
      // `receive` đọc yêu cầu rồi đọc đơn (order.findUnique); sửa số lượng dòng ngay sau lần đọc đơn đó, trước khi vào tx.
      const original = prisma.order.findUnique.bind(prisma.order);
      let hit = false;
      const spy = jest.spyOn(prisma.order, 'findUnique').mockImplementation(((...args: Parameters<typeof original>) => {
        const result = original(...args);
        if (!hit) {
          hit = true;
          return result.then(async (r) => {
            await prisma.returnRequestItem.updateMany({ where: { returnRequestId: req.id, orderItemId: item.id }, data: { quantity: 1 } });
            return r;
          });
        }
        return result;
      }) as never);
      try {
        await returns.markReceived(admin.id, req.id);
      } finally {
        spy.mockRestore();
      }
      expect(hit).toBe(true);
      expect(await stockOf(variation.id)).toBe(before + 1);
    });
  });
});
