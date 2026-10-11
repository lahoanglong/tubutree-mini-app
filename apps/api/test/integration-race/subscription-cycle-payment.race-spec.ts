import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { PREPAID_METHODS } from '../../src/modules/orders/order-transition';
import {
  SubscriptionsService,
  SUBSCRIPTION_DUPLICATE,
} from '../../src/modules/subscriptions/subscriptions.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-015 / A1-016 (Q-13, docs/2026-10-review): đơn đầu giao ngay hoặc từ ngày khách chọn; trả COD / Ví Tubu /
 * chuyển khoản; sửa được số lượng + địa chỉ gói đang chạy/tạm dừng. Phần tiền chạy trên Postgres thật:
 * mỗi (gói, kỳ) tối đa 1 đơn, trừ ví khớp sổ cái, thiếu ví thì gói tạm dừng chứ không sinh đơn nợ, và
 * sửa gói song song với cron không sinh đơn trộn số lượng/địa chỉ cũ-mới.
 */
describe('Gói định kỳ: đơn đầu, thanh toán, sửa gói (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const SHIP = 20_000;

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
          useValue: {
            calcShippingFee: jest.fn().mockResolvedValue(SHIP),
            calcPointsEarned: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: LoyaltyService, useValue: { getTierMultiplier: jest.fn().mockResolvedValue(1) } },
        { provide: NotificationsService, useValue: { notify } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  /** Ngày theo giờ Việt Nam, cách hôm nay `days` ngày, dạng YYYY-MM-DD. */
  const vnDate = (days: number) => new Date(Date.now() + 7 * 3600e3 + days * 864e5).toISOString().slice(0, 10);

  async function variation(stock = 50) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        affiliateRate: 10,
        stock,
      },
      include: { product: true },
    });
  }

  async function address(userId: string, street = '1 Duong IT') {
    return prisma.address.create({
      data: {
        userId,
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street,
        provinceCode: '01',
        districtCode: '',
        wardCode: '00001',
      },
    });
  }

  /** Sổ cái khớp số dư: walletBalance == SUM(delta) của user (C-060). */
  async function expectLedgerBalanced(userId: string) {
    const [u, agg] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.aggregate({ where: { userId }, _sum: { delta: true } }),
    ]);
    expect(u.walletBalance).toBe(agg._sum.delta ?? 0);
    return u.walletBalance;
  }

  /** Người dùng có sẵn số dư ví, ghi qua sổ cái như dữ liệu thật. */
  async function userWithWallet(balance: number) {
    const u = await createUser(prisma);
    if (balance > 0) {
      await prisma.$transaction(async (tx) => {
        await moduleRef
          .get(WalletLedgerService)
          .applyDelta(tx, { userId: u.id, delta: balance, type: 'ADJUST', reason: 'IT nạp ví' });
      });
    }
    return u;
  }

  /** Đưa gói về trạng thái đến hạn để cron xử lý. */
  async function makeDue(subId: string) {
    await prisma.subscription.update({ where: { id: subId }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
  }

  describe('đơn đầu', () => {
    it('không chọn ngày → giao NGAY: có đúng 1 đơn COD CONFIRMED gắn gói, kỳ sau dời 1 chu kỳ', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a = await address(u.id);
      const sub = await subs.create(u.id, { variationId: v.id, quantity: 2, intervalWeeks: 4, addressId: a.id });

      const orders = await prisma.order.findMany({ where: { subscriptionId: sub.id }, include: { items: true } });
      expect(orders).toHaveLength(1);
      expect(orders[0]).toEqual(
        expect.objectContaining({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', userId: u.id }),
      );
      expect(orders[0].items[0]).toEqual(expect.objectContaining({ variationId: v.id, quantity: 2 }));
      expect(sub.firstOrder).toEqual(expect.objectContaining({ id: orders[0].id, code: orders[0].code }));
      const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(row.lastOrderId).toBe(orders[0].id);
      const days = (row.nextRunAt.getTime() - Date.now()) / 864e5;
      expect(days).toBeGreaterThan(4 * 7 - 1);
      expect(days).toBeLessThan(4 * 7 + 1);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(48);
    });

    it('chọn ngày trong tương lai → chưa có đơn, kỳ đầu là 0h ngày đó giờ Việt Nam', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a = await address(u.id);
      const start = vnDate(5);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        startDate: start,
      });
      expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(0);
      expect(sub.firstOrder).toBeNull();
      const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(row.nextRunAt.toISOString()).toBe(new Date(`${start}T00:00:00+07:00`).toISOString());
    });

    it('ngày bắt đầu đã qua / quá xa / sai định dạng → 400, không tạo gói', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a = await address(u.id);
      for (const startDate of [vnDate(-1), vnDate(400), '2026-02-31', 'mai']) {
        await expect(
          subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: a.id, startDate }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(0);
    });

    it('trả bằng Ví Tubu, đủ tiền → đơn PAID, trừ đúng tổng tiền, 1 dòng ORDER_PAY khớp sổ cái', async () => {
      const u = await userWithWallet(1_000_000);
      const v = await variation();
      const a = await address(u.id);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        paymentMethod: 'WALLET',
      });
      const order = await prisma.order.findFirstOrThrow({ where: { subscriptionId: sub.id } });
      expect(order).toEqual(
        expect.objectContaining({ status: 'CONFIRMED', paymentMethod: 'WALLET', paymentStatus: 'PAID' }),
      );
      expect(order.paidAt).not.toBeNull();
      const pays = await prisma.walletTransaction.findMany({ where: { userId: u.id, type: 'ORDER_PAY' } });
      expect(pays).toEqual([expect.objectContaining({ delta: -order.total, refType: 'ORDER', refId: order.id })]);
      expect(await expectLedgerBalanced(u.id)).toBe(1_000_000 - order.total);
    });

    it('trả bằng Ví Tubu, thiếu tiền → 400, không gói, không đơn, không trừ kho, ví giữ nguyên', async () => {
      const u = await userWithWallet(50_000);
      const v = await variation();
      const a = await address(u.id);
      const err = await subs
        .create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: a.id, paymentMethod: 'WALLET' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('Ví Tubu');
      expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(50);
      expect(await expectLedgerBalanced(u.id)).toBe(50_000);
    });

    it('chuyển khoản → đơn PENDING_PAYMENT chưa trả, nằm trong diện cron huỷ đơn quá hạn thanh toán', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a = await address(u.id);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        paymentMethod: 'BANK_TRANSFER',
      });
      const order = await prisma.order.findFirstOrThrow({ where: { subscriptionId: sub.id } });
      expect(order).toEqual(
        expect.objectContaining({
          type: 'RETAIL',
          status: 'PENDING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'UNPAID',
          paidAt: null,
        }),
      );
      expect(PREPAID_METHODS).toContain('BANK_TRANSFER');
      expect(notify).toHaveBeenCalledWith(
        u.id,
        'SUBSCRIPTION_ORDER_AWAITING_PAYMENT',
        expect.objectContaining({ order_code: order.code }),
      );
    });
  });

  describe('cron sinh đơn kỳ', () => {
    it('5 lượt cron song song cho gói Ví Tubu đến hạn (5 vòng): đúng 1 đơn/kỳ, trừ ví đúng 1 lần, khớp sổ', async () => {
      for (let round = 0; round < 5; round++) {
        const u = await userWithWallet(1_000_000);
        const v = await variation();
        const a = await address(u.id);
        const sub = await subs.create(u.id, {
          variationId: v.id,
          quantity: 1,
          intervalWeeks: 4,
          addressId: a.id,
          paymentMethod: 'WALLET',
          startDate: vnDate(3),
        });
        await makeDue(sub.id);
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => subs.processDue()));
        const ctx = `vòng ${round}: ${summarize(results).errors.join(' | ')}`;

        const orders = await prisma.order.findMany({ where: { subscriptionId: sub.id } });
        const pays = await prisma.walletTransaction.findMany({ where: { userId: u.id, type: 'ORDER_PAY' } });
        expect({ ctx, orders: orders.length, pays: pays.length }).toEqual({ ctx, orders: 1, pays: 1 });
        expect(pays[0]).toEqual(expect.objectContaining({ delta: -orders[0].total, refId: orders[0].id }));
        expect(await expectLedgerBalanced(u.id)).toBe(1_000_000 - orders[0].total);
        expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(49);
      }
    });

    it('gói Ví Tubu đến hạn nhưng ví thiếu → gói TẠM DỪNG + báo khách, không đơn, không trừ kho/ví', async () => {
      const u = await userWithWallet(500_000);
      const v = await variation();
      const a = await address(u.id);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        paymentMethod: 'WALLET',
        startDate: vnDate(3),
      });
      // Khách tiêu bớt ví trước ngày giao.
      await prisma.$transaction((tx) =>
        moduleRef
          .get(WalletLedgerService)
          .applyDelta(tx, { userId: u.id, delta: -480_000, type: 'ADJUST', reason: 'IT tiêu ví' }),
      );
      await makeDue(sub.id);
      await subs.processDue();

      expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(0);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('PAUSED');
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(50);
      expect(await expectLedgerBalanced(u.id)).toBe(20_000);
      expect(notify).toHaveBeenCalledWith(
        u.id,
        'SUBSCRIPTION_PAUSED',
        expect.objectContaining({ reason: expect.stringContaining('Ví Tubu') }),
      );
    });

    it('gói chuyển khoản đến hạn → đơn PENDING_PAYMENT, không trừ ví', async () => {
      const u = await userWithWallet(1_000_000);
      const v = await variation();
      const a = await address(u.id);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        paymentMethod: 'BANK_TRANSFER',
        startDate: vnDate(2),
      });
      await makeDue(sub.id);
      await subs.processDue();
      const orders = await prisma.order.findMany({ where: { subscriptionId: sub.id } });
      expect(orders).toEqual([
        expect.objectContaining({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }),
      ]);
      expect(await expectLedgerBalanced(u.id)).toBe(1_000_000);
    });
  });

  describe('sửa số lượng / địa chỉ', () => {
    it('sửa gói ACTIVE và PAUSED: đổi số lượng + địa chỉ + phương thức thanh toán', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a1 = await address(u.id);
      const a2 = await address(u.id, '2 Duong IT');
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a1.id,
        startDate: vnDate(3),
      });
      const updated = await subs.update(u.id, sub.id, { quantity: 4, addressId: a2.id, paymentMethod: 'BANK_TRANSFER' });
      expect(updated).toEqual(
        expect.objectContaining({ quantity: 4, addressId: a2.id, paymentMethod: 'BANK_TRANSFER', status: 'ACTIVE' }),
      );
      await subs.setStatus(u.id, sub.id, 'PAUSED');
      const paused = await subs.update(u.id, sub.id, { quantity: 2 });
      expect(paused).toEqual(expect.objectContaining({ quantity: 2, addressId: a2.id, status: 'PAUSED' }));
    });

    it('từ chối: địa chỉ của người khác, gói đã huỷ, gói của người khác, SP ngừng bán', async () => {
      const u = await createUser(prisma);
      const other = await createUser(prisma);
      const v = await variation();
      const a = await address(u.id);
      const foreign = await address(other.id);
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a.id,
        startDate: vnDate(3),
      });
      await expect(subs.update(u.id, sub.id, { addressId: foreign.id })).rejects.toThrow('Địa chỉ không hợp lệ');
      await expect(subs.update(other.id, sub.id, { quantity: 2 })).rejects.toThrow('Không tìm thấy');
      await prisma.product.update({ where: { id: v.productId }, data: { isActive: false } });
      await expect(subs.update(u.id, sub.id, { quantity: 2 })).rejects.toMatchObject({
        response: { code: 'PRODUCT_DISCONTINUED' },
      });
      await prisma.product.update({ where: { id: v.productId }, data: { isActive: true } });
      await subs.setStatus(u.id, sub.id, 'CANCELLED');
      await expect(subs.update(u.id, sub.id, { quantity: 2 })).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toEqual(
        expect.objectContaining({ quantity: 1, addressId: a.id }),
      );
    });

    it('chuyển sang địa chỉ đã có gói cùng SP → 409 SUBSCRIPTION_DUPLICATE (giữ unique C-057)', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a1 = await address(u.id);
      const a2 = await address(u.id, '2 Duong IT');
      const base = { variationId: v.id, quantity: 1, intervalWeeks: 4, startDate: vnDate(3) };
      const s1 = await subs.create(u.id, { ...base, addressId: a1.id });
      const s2 = await subs.create(u.id, { ...base, addressId: a2.id });
      const err = await subs.update(u.id, s1.id, { addressId: a2.id }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: SUBSCRIPTION_DUPLICATE, subscriptionId: s2.id }),
      );
    });

    it('2 gói đổi chéo sang cùng một địa chỉ song song (10 vòng): đúng 1 gói đổi được, không vi phạm unique', async () => {
      for (let round = 0; round < 10; round++) {
        const u = await createUser(prisma);
        const v = await variation();
        const [a1, a2, target] = await Promise.all([address(u.id), address(u.id, '2'), address(u.id, '3')]);
        const base = { variationId: v.id, quantity: 1, intervalWeeks: 4, startDate: vnDate(3) };
        const s1 = await subs.create(u.id, { ...base, addressId: a1.id });
        const s2 = await subs.create(u.id, { ...base, addressId: a2.id });
        const results = await Promise.allSettled([
          subs.update(u.id, s1.id, { addressId: target.id }),
          subs.update(u.id, s2.id, { addressId: target.id }),
        ]);
        const { fulfilled, rejected, errors } = summarize(results);
        const ctx = `vòng ${round}: ${errors.join(' | ')}`;
        expect({ ctx, ok: fulfilled.length, conflict: rejected.every((r) => r.reason instanceof ConflictException) }).toEqual({
          ctx,
          ok: 1,
          conflict: true,
        });
        expect(await prisma.subscription.count({ where: { userId: u.id, addressId: target.id } })).toBe(1);
      }
    });

    it('sửa gói ngay sau khi cron đã nhận kỳ, trước khi ghi đơn: đơn theo đúng bản đã sửa, không lấy số cũ', async () => {
      const u = await createUser(prisma);
      const v = await variation();
      const a1 = await address(u.id);
      const a2 = await address(u.id, '99 Duong Moi');
      const sub = await subs.create(u.id, {
        variationId: v.id,
        quantity: 1,
        intervalWeeks: 4,
        addressId: a1.id,
        startDate: vnDate(3),
      });
      await makeDue(sub.id);
      const original = prisma.subscription.updateMany.bind(prisma.subscription);
      let edited = false;
      // Bước nhận kỳ của cron (updateMany có điều kiện nextRunAt) xong thì khách sửa gói ngay.
      const spy = jest.spyOn(prisma.subscription, 'updateMany').mockImplementation((async (
        args: Parameters<typeof original>[0],
      ) => {
        const res = await original(args);
        if (!edited && res.count === 1 && args.data && 'nextRunAt' in args.data) {
          edited = true;
          await subs.update(u.id, sub.id, { quantity: 3, addressId: a2.id });
        }
        return res;
      }) as unknown as typeof original);
      await subs.processDue();
      spy.mockRestore();

      expect(edited).toBe(true);
      const order = await prisma.order.findFirstOrThrow({ where: { subscriptionId: sub.id }, include: { items: true } });
      expect(order.items[0].quantity).toBe(3);
      expect((order.shippingAddress as { street?: string }).street).toBe('99 Duong Moi');
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(47);
    });

    it('sửa gói song song với cron (15 vòng): đơn luôn là bản cũ trọn vẹn hoặc bản mới trọn vẹn', async () => {
      for (let round = 0; round < 15; round++) {
        const u = await createUser(prisma);
        const v = await variation();
        const a1 = await address(u.id, 'Cu');
        const a2 = await address(u.id, 'Moi');
        const sub = await subs.create(u.id, {
          variationId: v.id,
          quantity: 1,
          intervalWeeks: 4,
          addressId: a1.id,
          startDate: vnDate(3),
        });
        await makeDue(sub.id);
        const results = await Promise.allSettled([
          subs.processDue(),
          subs.update(u.id, sub.id, { quantity: 5, addressId: a2.id }),
        ]);
        const ctx = `vòng ${round}: ${summarize(results).errors.join(' | ')}`;
        const orders = await prisma.order.findMany({ where: { subscriptionId: sub.id }, include: { items: true } });
        expect({ ctx, orders: orders.length }).toEqual({ ctx, orders: 1 });
        const pair = `${orders[0].items[0].quantity}@${(orders[0].shippingAddress as { street?: string }).street}`;
        expect({ ctx, ok: ['1@Cu', '5@Moi'].includes(pair), pair }).toEqual({ ctx, ok: true, pair });
        const stock = (await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock;
        expect(stock).toBe(50 - orders[0].items[0].quantity);
      }
    });
  });
});
