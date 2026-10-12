import type { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * PF-3 mục 1: huỷ/trả đơn (LoyaltyService.reverseOrderPoints) so với cron hết hạn điểm.
 *
 * (a) reverseOrderPoints không khoá dòng user nên cron hết hạn có thể commit giữa lúc nó đã đọc sổ và lúc nó ghi
 *     dòng thu hồi: lô đơn bị trừ hai lần (POINTS_EXPIRED rồi ORDER_REVERSED).
 * (b) đơn bị huỷ/trả khi lô ORDER_DELIVERED đã hết hạn và cron đã trừ: thu hồi pointsEarned lần nữa là trừ hai lần,
 *     có thể kéo số dư xuống âm. Chỉ thu hồi phần còn lại của lô, không bao giờ âm, không đòi lại điểm đã tiêu.
 *
 * "Thời gian trôi" dựng bằng lùi createdAt/expiresAt trong sổ như pe5-reversal-expiry.
 */
describe('huỷ/trả đơn so với cron hết hạn điểm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        LoyaltyExpiryService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(SystemConfigService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    await warmPool(prisma);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function customer() {
    const user = await createUser(prisma);
    touched.push(user.id);
    return user;
  }

  /** Lô cũ không hạn (điểm trước PE-3): dòng sổ cộng số dư, khớp sổ. */
  async function oldLot(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'IT_OLD_LOT', refType: 'GAME', createdAt: new Date(Date.now() - 400 * DAY), expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Đơn DELIVERED đã tích `earned` điểm; `used` điểm thường đã tiêu lúc đặt (dòng ORDER_REDEEM như CheckoutService). */
  async function deliveredOrder(userId: string, earned: number, used = 0) {
    const order = await createOrder(prisma, { userId, status: 'DELIVERED', pointsEarned: earned, pointsUsed: used });
    if (used > 0) {
      await prisma.$transaction([
        prisma.pointsTransaction.create({
          data: { userId, delta: -used, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id, createdAt: new Date(Date.now() - 20 * DAY) },
        }),
        prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: used } } }),
      ]);
    }
    await loyalty.creditOrderPoints(order.id);
    return order;
  }

  /** Tiêu điểm thẳng trên sổ (dòng âm lô STANDARD + trừ số dư), như đổi quà hay góp quỹ. */
  async function spend(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId, delta: -points, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: points } } }),
    ]);
  }

  /** Lô thưởng game không hạn tạo SAU lô đơn (createdAt do test đặt để thứ tự lô cố định). */
  async function gameLot(userId: string, points: number, createdAt: Date) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'GAME_SPIN_WIN', refType: 'GAME', createdAt, expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Lùi createdAt của các dòng có reason bắt đầu bằng `prefix` đi `days` ngày (đẩy lô đó về trước trong thứ tự FIFO). */
  async function backdate(userId: string, prefix: string, days: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${days}::int * interval '1 day')
       WHERE "userId" = ${userId} AND "reason" LIKE ${prefix + '%'}`;
  }

  /** Thời gian trôi N tháng: lùi mọi mốc createdAt/expiresAt của user đi N tháng (NULL giữ NULL). */
  async function ageLedger(userId: string, months: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${months}::int * interval '1 month'),
             "expiresAt" = "expiresAt" - (${months}::int * interval '1 month')
       WHERE "userId" = ${userId}`;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const standardSum = async (userId: string) =>
    (await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } }))._sum.delta ?? 0;
  const rowsOf = (userId: string, prefix: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } }, orderBy: { createdAt: 'asc' } });
  const expiredRows = (userId: string) => rowsOf(userId, 'POINTS_EXPIRED');
  const reversedRows = (userId: string) => rowsOf(userId, 'ORDER_REVERSED:');

  /** Số kết nối đang chờ một khoá dòng. */
  const lockWaiters = async () =>
    (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0]!.n;

  async function waitFor(done: () => Promise<boolean> | boolean) {
    for (let i = 0; i < 200 && !(await done()); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Prisma mà transaction đầu tiên dừng ở lệnh ghi điểm đầu tiên (sau mọi lệnh đọc của nó) cho tới khi test mở cổng:
   * dựng đúng thứ tự "đã đọc sổ, chưa ghi" để cron chen vào giữa. Bản đã khoá dòng user giữ khoá trong lúc dừng, nên
   * cron phải chờ; bản chưa khoá thì cron chạy xong hẳn.
   */
  function holdAtFirstLedgerWrite(real: PrismaService) {
    let reached!: () => void;
    const atWrite = new Promise<void>((resolve) => (reached = resolve));
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let armed = true;
    const heldTx = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop !== 'pointsTransaction') return typeof value === 'function' ? value.bind(target) : value;
          return new Proxy(value as object, {
            get(model, method) {
              const fn = Reflect.get(model, method, model) as (...args: unknown[]) => unknown;
              if (method !== 'create' || !armed) return typeof fn === 'function' ? fn.bind(model) : fn;
              return async (...args: unknown[]) => {
                armed = false;
                reached();
                await gate;
                return fn.apply(model, args);
              };
            },
          });
        },
      });
    const prismaHeld = new Proxy(real, {
      get(target, prop) {
        if (prop === '$transaction') {
          return (fn: unknown, ...rest: unknown[]) =>
            typeof fn === 'function'
              ? (target.$transaction as (...a: unknown[]) => unknown)((tx: Prisma.TransactionClient) => (fn as (t: unknown) => unknown)(heldTx(tx)), ...rest)
              : (target.$transaction as (...a: unknown[]) => unknown)(fn, ...rest);
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as PrismaService;
    return { prisma: prismaHeld, atWrite, open: () => open() };
  }

  describe('(a) khoá dòng user: cron chen vào giữa lúc reverseOrderPoints đã đọc sổ và chưa ghi', () => {
    it('lô đơn đã quá hạn, cron chạy đúng lúc đó → điểm của đơn chỉ bị trừ một lần', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await ageLedger(user.id, 13); // lô đơn +20 quá hạn, cron chưa chạy

      const held = holdAtFirstLedgerWrite(prisma);
      const reversal = new LoyaltyService(held.prisma, config).reverseOrderPoints(order.id);
      await held.atWrite;
      let cronDone = false;
      const cron = expiry.expirePoints().finally(() => (cronDone = true));
      await waitFor(async () => cronDone || (await lockWaiters()) > 0);
      held.open();
      await Promise.all([reversal, cron]);

      const taken = [...(await reversedRows(user.id)), ...(await expiredRows(user.id))].reduce((sum, row) => sum + row.delta, 0);
      expect(taken).toBe(-20);
      expect(await balance(user.id)).toBe(30);
      expect(await standardSum(user.id)).toBe(30);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(30);
    });

    it('4 lượt huỷ/trả cùng một đơn chạy song song (orders.cancel + webhook) → đúng một dòng ORDER_REVERSED, trừ một lần', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);

      const results = summarize(await Promise.allSettled(Array.from({ length: 4 }, () => loyalty.reverseOrderPoints(order.id))));

      expect(results.errors).toEqual([]);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(30);
    });
  });

  describe('(b) lô đơn đã hết hạn và cron đã trừ trước lúc huỷ/trả', () => {
    it('còn lô cũ 30: không trừ lần hai, số dư giữ 30, dòng ORDER_REVERSED ghi 0 để đánh dấu đã xử lý', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(30);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(30);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([0]);
      await loyalty.reverseOrderPoints(order.id); // gọi lại: vẫn một dòng
      expect(await reversedRows(user.id)).toHaveLength(1);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(30);
      expect(await standardSum(user.id)).toBe(30);
    });

    it('không còn lô nào khác: số dư ở 0, không xuống âm', async () => {
      const user = await customer();
      const order = await deliveredOrder(user.id, 20);
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(0);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(0);
      expect(await standardSum(user.id)).toBe(0);
    });

    it('đơn đã tiêu 40 điểm: điểm đã tiêu vẫn được hoàn, chỉ phần tích (đã hết hạn) không bị trừ lần hai', async () => {
      const user = await customer();
      await oldLot(user.id, 100);
      const order = await deliveredOrder(user.id, 20, 40);
      expect(await balance(user.id)).toBe(80);
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(60);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(100);
      expect((await rowsOf(user.id, 'ORDER_REFUND_POINTS:')).map((r) => r.delta)).toEqual([40]);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([0]);
    });

    it('admin đặt loyalty.point_expire_months ngắn (1 tháng) hơn cửa sổ trả hàng 45 ngày: huỷ đơn sau hạn không trừ hai lần', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      await config.set('loyalty.point_expire_months', 1, 'it-pf3');
      let order;
      try {
        order = await deliveredOrder(user.id, 20);
      } finally {
        await config.set('loyalty.point_expire_months', 12, 'it-pf3');
      }
      await ageLedger(user.id, 2); // 45 ngày sau khi giao: lô đã quá hạn 1 tháng
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(30);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(30);
    });
  });

  describe('lô đơn là lô CŨ NHẤT còn tồn: chi tiêu từ lô khác ăn vào nó theo FIFO không làm điểm của đơn "đã tiêu"', () => {
    it('đơn giao 2 ngày trước (+20, đang bị khoá), thưởng game +100, khách tiêu đúng phần số dư vượt phần khoá (100) → trả hàng thu hồi đủ 20', async () => {
      const user = await customer();
      const order = await deliveredOrder(user.id, 20);
      await backdate(user.id, 'ORDER_DELIVERED:', 2);
      await gameLot(user.id, 100, new Date(Date.now() - 1 * DAY));
      const lock = await loyalty.lockedOrderPoints(user.id, new Date());
      expect(lock.locked).toBe(20);
      expect(await balance(user.id)).toBe(120);
      await spend(user.id, 100); // đúng phần được phép tiêu: số dư 120 - khoá 20
      expect(await balance(user.id)).toBe(20);

      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(0);
      expect(await standardSum(user.id)).toBe(0);
    });

    it('lô cũ không hạn nằm TRƯỚC lô đơn vẫn như cũ: tiêu 40 (ăn lô cũ 30 và 10 của lô đơn) → số dư 10 chỉ đủ thu hồi 10', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await spend(user.id, 40);

      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-10]);
      expect(await balance(user.id)).toBe(0);
    });
  });

  describe('trần thu hồi tính SAU khi cộng điểm hoàn của chính đơn đó (cùng transaction)', () => {
    it('số dư 0 nhưng đơn từng dùng 40 điểm: điểm hoàn 40 đủ trang trải việc thu hồi 20, không cắt thu hồi xuống 0', async () => {
      const user = await customer();
      await oldLot(user.id, 40);
      const order = await deliveredOrder(user.id, 20, 40); // dùng 40 điểm lúc đặt, giao rồi tích 20: số dư 20
      await spend(user.id, 20);
      expect(await balance(user.id)).toBe(0);

      await loyalty.reverseOrderPoints(order.id);

      expect((await rowsOf(user.id, 'ORDER_REFUND_POINTS:')).map((r) => r.delta)).toEqual([40]);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(20);
      expect(await standardSum(user.id)).toBe(20);
    });

    it('điểm hoàn không đủ trang trải thì phần thiếu vẫn bị cắt theo số dư sau hoàn, không bao giờ âm', async () => {
      const user = await customer();
      await oldLot(user.id, 10);
      const order = await deliveredOrder(user.id, 20, 5); // dùng 5 điểm, tích 20: số dư 25
      await spend(user.id, 25);
      expect(await balance(user.id)).toBe(0);

      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-5]);
      expect(await balance(user.id)).toBe(0);
      expect(await standardSum(user.id)).toBe(0);
    });
  });

  describe('lịch sử điểm của khách không hiện dòng ORDER_REVERSED delta 0 (dòng đó chỉ là dấu đã xử lý)', () => {
    it('đã tiêu hết nên thu hồi 0: dòng đánh dấu vẫn nằm trong sổ nhưng getPointsTransactions không trả nó; dòng thu hồi thật và dòng hoàn vẫn hiện', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const zero = await deliveredOrder(user.id, 20);
      await spend(user.id, 50);
      await loyalty.reverseOrderPoints(zero.id);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([0]);

      const real = await customer();
      await oldLot(real.id, 30);
      const order = await deliveredOrder(real.id, 20, 10);
      await loyalty.reverseOrderPoints(order.id);

      const zeroHistory = await loyalty.getPointsTransactions(user.id);
      expect(zeroHistory.some((r) => r.reason.startsWith('ORDER_REVERSED:'))).toBe(false);
      expect(zeroHistory.map((r) => r.reason)).toContain(`ORDER_DELIVERED:${zero.code}`);
      const realHistory = await loyalty.getPointsTransactions(real.id);
      expect(realHistory.filter((r) => r.reason.startsWith('ORDER_REVERSED:')).map((r) => r.delta)).toEqual([-20]);
      expect(realHistory.filter((r) => r.reason.startsWith('ORDER_REFUND_POINTS:')).map((r) => r.delta)).toEqual([10]);
    });

    it('dấu delta 0 vẫn chặn lượt huỷ thứ hai và vẫn mở khoá điểm đơn (lockedOrderPoints) dù ẩn khỏi lịch sử', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await spend(user.id, 50);
      await loyalty.reverseOrderPoints(order.id);
      await oldLot(user.id, 7); // điểm mới về sau: lượt huỷ lặp lại (webhook) không được lấy lại gì
      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([0]);
      expect(await balance(user.id)).toBe(7);
      expect((await loyalty.lockedOrderPoints(user.id, new Date())).locked).toBe(0);
    });
  });

  describe('đơn còn hạn nhưng điểm đã tiêu: chỉ thu hồi phần còn lại, không âm', () => {
    it('lô cũ 30 + đơn +20, đã tiêu 40 (ăn lô cũ 30 rồi 10 của lô đơn) → thu hồi 10, số dư về 0 chứ không -10', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await spend(user.id, 40);
      expect(await balance(user.id)).toBe(10);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(0);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-10]);
    });

    it('đã tiêu hết 50 điểm → không thu hồi gì (dòng đánh dấu 0), số dư ở 0', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await spend(user.id, 50);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(0);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([0]);
    });

    it('điểm của đơn còn nguyên → thu hồi đủ như trước', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);

      await loyalty.reverseOrderPoints(order.id);

      expect(await balance(user.id)).toBe(30);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
    });
  });
});
