import { randomInt } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { createUser, deleteItData, randCode, summarize, warmPool } from './helpers';

const SCHEDULE_CHANGED = 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.';
const INTERVAL_WEEKS = 4;
const STEP_MS = INTERVAL_WEEKS * 7 * 864e5;
const ROUNDS = 10;

/**
 * Khách bỏ qua kỳ / tạm dừng gói đúng lúc cron 03:00 đang bốc gói (Postgres thật). Cả hai bên ghi CÓ ĐIỀU KIỆN theo bản vừa đọc
 * (trạng thái + nextRunAt), nên bên đến sau luôn thấy bản đã đổi và dừng: hoặc cron thắng (đúng một đơn, khách nhận 409 "Lịch giao
 * vừa thay đổi", lịch chỉ dời một chu kỳ do cron), hoặc khách thắng (không đơn, không trừ tồn, cron bỏ qua gói). Mini dựa vào mã 409
 * này để tải lại danh sách gói và giữ khoá tới khi lịch mới về; lệch một trong hai (hai đơn, dời hai chu kỳ, "đã bỏ qua" mà vẫn ra
 * đơn) là lỗi tiền thật. Thứ tự chen giữa được ép bằng cách giữ lời đọc đầu của một bên cho tới khi bên kia chạy xong.
 */
describe('Gói định kỳ: bỏ qua kỳ / tạm dừng ‖ cron processDue (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;
  const created = { userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        WalletLedgerService,
        SubscriptionsService,
        {
          provide: PricingService,
          useValue: { calcShippingFee: jest.fn().mockResolvedValue(20_000), calcPointsEarned: jest.fn().mockResolvedValue(0) },
        },
        { provide: LoyaltyService, useValue: { getTierMultiplier: jest.fn().mockResolvedValue(1) } },
        {
          provide: NotificationsService,
          useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM "subscriptions" WHERE "userId" = ANY(${created.userIds}::text[])`;
      await deleteItData(prisma, created);
    }
    await moduleRef?.close();
  });

  const vnDate = (days: number) => new Date(Date.now() + 7 * 3600e3 + days * 864e5).toISOString().slice(0, 10);

  /** Gói ACTIVE sắp tới hạn: khách có địa chỉ, biến thể tồn 50, nextRunAt lùi một phút để cron bốc. */
  async function dueSub() {
    const u = await createUser(prisma);
    created.userIds.push(u.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 50 },
    });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
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
    const sub = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: INTERVAL_WEEKS, addressId: addr.id, startDate: vnDate(3) });
    const dueAt = new Date(Date.now() - 60_000);
    await prisma.subscription.update({ where: { id: sub.id }, data: { nextRunAt: dueAt } });
    return { u, v, sub, dueAt };
  }

  const state = async (subId: string, variationId: string) => ({
    sub: await prisma.subscription.findUniqueOrThrow({ where: { id: subId } }),
    orders: await prisma.order.count({ where: { subscriptionId: subId } }),
    stock: (await prisma.variation.findUniqueOrThrow({ where: { id: variationId } })).stock,
  });

  /** Giữ kết quả lời đọc ĐẦU của `method` tới khi `release()` được gọi; `readDone` xong khi lời đọc đó đã trả về. */
  function holdFirstRead<T extends object, K extends keyof T>(obj: T, method: K) {
    const original = (obj[method] as unknown as (...a: unknown[]) => Promise<unknown>).bind(obj);
    let read!: () => void;
    let release!: () => void;
    const readDone = new Promise<void>((r) => (read = r));
    const gate = new Promise<void>((r) => (release = r));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(obj as any, method as any).mockImplementationOnce(async (...args: unknown[]) => {
      const result = await original(...args);
      read();
      await gate;
      return result;
    });
    return { readDone, release };
  }

  describe('cron thắng: khách đọc bản cũ rồi cron bốc gói và ra đơn trước khi khách ghi', () => {
    it('bỏ qua kỳ: 409 SCHEDULE_CHANGED, đúng một đơn, lịch dời đúng một chu kỳ do cron (không dời thêm lần hai), tồn trừ một lần', async () => {
      const { u, v, sub } = await dueSub();
      const cronBase = new Date(`${vnDate(0)}T00:00:00+07:00`).getTime();
      const hold = holdFirstRead(prisma.subscription, 'findUnique');
      const skipping = subs.skipCycle(u.id, sub.id).catch((e: unknown) => e);
      await hold.readDone;
      await subs.processDue();
      hold.release();
      const err = await skipping;

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SCHEDULE_CHANGED);
      const after = await state(sub.id, v.id);
      expect(after.orders).toBe(1);
      expect(after.stock).toBe(49);
      expect(after.sub.status).toBe('ACTIVE');
      expect(after.sub.nextRunAt.getTime()).toBe(cronBase + STEP_MS);
    });

    it('tạm dừng: 409 SCHEDULE_CHANGED, đúng một đơn, gói vẫn ACTIVE (lịch do cron dời giữ nguyên)', async () => {
      const { u, v, sub } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findUnique');
      const pausing = subs.setStatus(u.id, sub.id, 'PAUSED').catch((e: unknown) => e);
      await hold.readDone;
      await subs.processDue();
      hold.release();
      const err = await pausing;

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SCHEDULE_CHANGED);
      const after = await state(sub.id, v.id);
      expect(after.orders).toBe(1);
      expect(after.stock).toBe(49);
      expect(after.sub.status).toBe('ACTIVE');
    });

    it('sau 409, thử lại với bản mới tải về thì thành công: bỏ qua kỳ dời thêm đúng một chu kỳ từ lịch của cron', async () => {
      const { u, v, sub } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findUnique');
      const first = subs.skipCycle(u.id, sub.id).catch((e: unknown) => e);
      await hold.readDone;
      await subs.processDue();
      hold.release();
      expect(await first).toBeInstanceOf(ConflictException);
      const afterCron = await state(sub.id, v.id);

      await subs.skipCycle(u.id, sub.id);
      const afterRetry = await state(sub.id, v.id);
      expect(afterRetry.orders).toBe(1);
      expect(afterRetry.sub.nextRunAt.getTime()).toBe(afterCron.sub.nextRunAt.getTime() + STEP_MS);
    });
  });

  describe('khách thắng: cron đọc danh sách đến hạn trước, khách ghi xong rồi cron mới bốc', () => {
    it('bỏ qua kỳ: không đơn, không trừ tồn, lịch dời đúng một chu kỳ từ ngày hẹn cũ', async () => {
      const { u, v, sub, dueAt } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findMany');
      const cron = subs.processDue();
      await hold.readDone;
      await subs.skipCycle(u.id, sub.id);
      hold.release();
      await cron;

      const after = await state(sub.id, v.id);
      expect(after.orders).toBe(0);
      expect(after.stock).toBe(50);
      expect(after.sub.status).toBe('ACTIVE');
      expect(after.sub.nextRunAt.getTime()).toBe(dueAt.getTime() + STEP_MS);
    });

    it('tạm dừng: không đơn, không trừ tồn, gói PAUSED, lịch giữ nguyên ngày hẹn cũ (cron không bốc, không dời lịch gói đã dừng dù đã đọc nó là ACTIVE)', async () => {
      const { u, v, sub, dueAt } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findMany');
      const cron = subs.processDue();
      await hold.readDone;
      await subs.setStatus(u.id, sub.id, 'PAUSED');
      hold.release();
      await cron;

      const after = await state(sub.id, v.id);
      expect(after.orders).toBe(0);
      expect(after.stock).toBe(50);
      expect(after.sub.status).toBe('PAUSED');
      expect(after.sub.nextRunAt.getTime()).toBe(dueAt.getTime());
    });
  });

  describe('hai thiết bị của cùng khách: một bên đọc bản ACTIVE, bên kia đã đổi trạng thái gói trước khi bên này ghi', () => {
    it('tạm dừng trên bản cũ sau khi thiết bị kia đã huỷ gói: 409 SCHEDULE_CHANGED, gói vẫn CANCELLED (không sống lại thành PAUSED)', async () => {
      const { u, v, sub, dueAt } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findUnique');
      const pausing = subs.setStatus(u.id, sub.id, 'PAUSED').catch((e: unknown) => e);
      await hold.readDone;
      await subs.setStatus(u.id, sub.id, 'CANCELLED');
      hold.release();
      const err = await pausing;

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SCHEDULE_CHANGED);
      const after = await state(sub.id, v.id);
      expect(after.sub.status).toBe('CANCELLED');
      expect(after.sub.nextRunAt.getTime()).toBe(dueAt.getTime());
      expect(after.orders).toBe(0);
    });

    it('bỏ qua kỳ trên bản cũ sau khi thiết bị kia đã tạm dừng gói: 409 SCHEDULE_CHANGED, gói vẫn PAUSED và lịch không dời', async () => {
      const { u, v, sub, dueAt } = await dueSub();
      const hold = holdFirstRead(prisma.subscription, 'findUnique');
      const skipping = subs.skipCycle(u.id, sub.id).catch((e: unknown) => e);
      await hold.readDone;
      await subs.setStatus(u.id, sub.id, 'PAUSED');
      hold.release();
      const err = await skipping;

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SCHEDULE_CHANGED);
      const after = await state(sub.id, v.id);
      expect(after.sub.status).toBe('PAUSED');
      expect(after.sub.nextRunAt.getTime()).toBe(dueAt.getTime());
      expect(after.orders).toBe(0);
    });
  });

  describe(`song song thật (${ROUNDS} vòng mỗi loại): chỉ có hai kết cục nhất quán`, () => {
    it('bỏ qua kỳ ‖ cron: ba kết cục nhất quán (cron thắng + 409, khách thắng, khách đọc sau claim), lịch luôn dời đúng bội số chu kỳ', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { u, v, sub, dueAt } = await dueSub();
        const cronBase = new Date(`${vnDate(0)}T00:00:00+07:00`).getTime();
        const results = await Promise.allSettled([subs.processDue(), subs.skipCycle(u.id, sub.id)]);
        const ctx = `vòng ${round}: ${summarize(results).errors.join(' | ')}`;
        const after = await state(sub.id, v.id);
        const skip = results[1];
        const next = after.sub.nextRunAt.getTime();
        if (after.orders === 0) {
          expect({ ctx, skip: skip.status, stock: after.stock, next }).toEqual({ ctx, skip: 'fulfilled', stock: 50, next: dueAt.getTime() + STEP_MS });
        } else if (skip.status === 'rejected') {
          expect({ ctx, stock: after.stock, msg: ((skip as PromiseRejectedResult).reason as Error).message, next }).toEqual({ ctx, stock: 49, msg: SCHEDULE_CHANGED, next: cronBase + STEP_MS });
        } else {
          // Lời đọc của khách tới sau claim của cron: máy chủ không biết khách định bỏ kỳ nào nên dời kỳ SAU (đơn kỳ này đã ra). Tồn đọng đã ghi ở PR: Mini cần gửi kèm ngày kỳ định bỏ.
          expect({ ctx, stock: after.stock, next }).toEqual({ ctx, stock: 49, next: cronBase + 2 * STEP_MS });
        }
        expect({ ctx, orders: after.orders <= 1, status: after.sub.status }).toEqual({ ctx, orders: true, status: 'ACTIVE' });
      }
    });

    it('tạm dừng ‖ cron: ba kết cục nhất quán (cron thắng + 409 + ACTIVE, tạm dừng sau claim, khách thắng), tồn trừ đúng số đơn', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { u, v, sub } = await dueSub();
        const results = await Promise.allSettled([subs.processDue(), subs.setStatus(u.id, sub.id, 'PAUSED')]);
        const ctx = `vòng ${round}: ${summarize(results).errors.join(' | ')}`;
        const after = await state(sub.id, v.id);
        const pause = results[1];
        if (after.orders === 0) {
          expect({ ctx, pause: pause.status, status: after.sub.status, stock: after.stock }).toEqual({ ctx, pause: 'fulfilled', status: 'PAUSED', stock: 50 });
        } else if (pause.status === 'rejected') {
          expect({ ctx, status: after.sub.status, stock: after.stock, msg: ((pause as PromiseRejectedResult).reason as Error).message }).toEqual({ ctx, status: 'ACTIVE', stock: 49, msg: SCHEDULE_CHANGED });
        } else {
          // Tạm dừng đọc sau claim: kỳ này đã ra đơn, gói dừng từ kỳ sau. Hợp lệ.
          expect({ ctx, status: after.sub.status, stock: after.stock }).toEqual({ ctx, status: 'PAUSED', stock: 49 });
        }
      }
    });
  });
});
