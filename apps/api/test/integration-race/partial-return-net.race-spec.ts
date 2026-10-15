import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser, setConfig } from './helpers';

const DAY = 864e5;

/**
 * Sau trả hàng MỘT PHẦN (đơn vẫn DELIVERED):
 *  - voucher mốc tính theo chi tiêu RÒNG (total trừ tiền hàng + ship đã hoàn của yêu cầu APPROVED, fullReturn=false);
 *  - điểm đang khoá của đơn trừ phần điểm đã thu hồi (pointsReversed).
 */
describe('trả một phần: voucher mốc và điểm khoá (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let vouchers: VouchersService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        VouchersService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    vouchers = moduleRef.get(VouchersService);
    await setConfig(prisma, 'returns.window_days', 7);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('milestoneVouchers', () => {
    async function milestoneCoupons(userId: string) {
      const rows = await prisma.coupon.findMany({
        where: { scope: 'USER_GROUP', scopeMeta: { path: ['userId'], equals: userId } },
        select: { value: true, code: true },
      });
      return rows.filter((c) => c.code.startsWith('MILESTONE'));
    }
    async function delivered(userId: string, total: number) {
      return createOrder(prisma, { userId, status: 'DELIVERED', total });
    }
    async function partialReturn(
      orderId: string,
      userId: string,
      refundAmount: number | null,
      shippingRefund = 0,
      status: 'APPROVED' | 'REQUESTED' | 'REJECTED' = 'APPROVED',
    ) {
      return prisma.returnRequest.create({
        data: { orderId, userId, reason: 'IT', status, refundAmount, shippingRefund, fullReturn: false },
      });
    }

    it('đạt mốc 1tr chỉ nhờ phần đã trả → KHÔNG cấp', async () => {
      const u = await createUser(prisma);
      const o = await delivered(u.id, 1_200_000);
      await partialReturn(o.id, u.id, 250_000);
      await vouchers.milestoneVouchers();
      expect(await milestoneCoupons(u.id)).toEqual([]);
    });

    it('phí ship hoàn cũng được trừ', async () => {
      const u = await createUser(prisma);
      const o = await delivered(u.id, 1_000_000);
      await partialReturn(o.id, u.id, null, 30_000);
      await vouchers.milestoneVouchers();
      expect(await milestoneCoupons(u.id)).toEqual([]);
    });

    it('trả một phần nhưng vẫn >= mốc → vẫn cấp đúng mốc', async () => {
      const u = await createUser(prisma);
      const o = await delivered(u.id, 3_500_000);
      await partialReturn(o.id, u.id, 400_000, 20_000); // ròng 3.08tr → mốc 3tr
      await vouchers.milestoneVouchers();
      const c = await milestoneCoupons(u.id);
      expect(c.map((x) => x.value)).toEqual([100_000]);
      expect(c[0]!.code).toContain('MILESTONE3000000-');
    });

    it('đơn không trả → hành vi cũ', async () => {
      const u = await createUser(prisma);
      await delivered(u.id, 1_000_000);
      await vouchers.milestoneVouchers();
      expect((await milestoneCoupons(u.id)).map((x) => x.value)).toEqual([30_000]);
    });

    it('yêu cầu REQUESTED / REJECTED chưa hoàn tiền → không trừ', async () => {
      const u = await createUser(prisma);
      const o = await delivered(u.id, 1_000_000);
      await partialReturn(o.id, u.id, 500_000, 0, 'REQUESTED');
      await partialReturn(o.id, u.id, 500_000, 0, 'REJECTED');
      await vouchers.milestoneVouchers();
      expect((await milestoneCoupons(u.id)).map((x) => x.value)).toEqual([30_000]);
    });

    it('nhiều đơn, nhiều lần trả: cộng ròng toàn bộ', async () => {
      const u = await createUser(prisma);
      const a = await delivered(u.id, 600_000);
      const b = await delivered(u.id, 600_000);
      await delivered(u.id, 1_900_000);
      await partialReturn(a.id, u.id, 100_000);
      await partialReturn(a.id, u.id, 50_000, 10_000);
      await partialReturn(b.id, u.id, 200_000);
      // 3.1tr - 360k = 2.74tr → mốc 1tr
      await vouchers.milestoneVouchers();
      expect((await milestoneCoupons(u.id)).map((x) => x.value)).toEqual([30_000]);
    });

    it('hoàn vượt tổng (dữ liệu lệch) → kẹp 0, không lỗi và không cấp', async () => {
      const u = await createUser(prisma);
      const o = await delivered(u.id, 500_000);
      await partialReturn(o.id, u.id, 400_000, 200_000);
      await vouchers.milestoneVouchers();
      expect(await milestoneCoupons(u.id)).toEqual([]);
    });
  });

  describe('lockedOrderPoints', () => {
    async function deliveredWithPoints(userId: string, points: number, deliveredDaysAgo = 1) {
      const deliveredAt = new Date(Date.now() - deliveredDaysAgo * DAY);
      const order = await createOrder(prisma, { userId, status: 'DELIVERED', pointsEarned: points, deliveredAt });
      await prisma.pointsTransaction.create({
        data: {
          userId,
          delta: points,
          lot: 'STANDARD',
          reason: `ORDER_DELIVERED:${order.code}`,
          refType: 'ORDER',
          refId: order.id,
          createdAt: deliveredAt,
        },
      });
      return order;
    }
    const ret = (orderId: string, userId: string, pointsReversed: number, status: 'APPROVED' | 'REQUESTED' = 'APPROVED') =>
      prisma.returnRequest.create({
        data: { orderId, userId, reason: 'IT', status, pointsReversed, fullReturn: false, refundAmount: 1000 },
      });
    const none = { locked: 0, lockedReturn: 0, lockedUntil: null };

    it('đơn chưa trả một phần → như cũ', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      const r = await loyalty.lockedOrderPoints(u.id, new Date());
      expect(r.locked).toBe(20);
      expect(r.lockedReturn).toBe(0);
      expect(r.lockedUntil?.getTime()).toBe((o.deliveredAt as Date).getTime() + 7 * DAY);
    });

    it('+20 điểm, trả một phần thu hồi 8 → khoá 12; trả tiếp thu hồi 12 → khoá 0, lockedUntil null', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      await ret(o.id, u.id, 8);
      let r = await loyalty.lockedOrderPoints(u.id, new Date());
      expect(r.locked).toBe(12);
      expect(r.lockedUntil).not.toBeNull();
      await ret(o.id, u.id, 12);
      r = await loyalty.lockedOrderPoints(u.id, new Date());
      expect(r).toEqual(none);
    });

    it('thu hồi vượt delta → kẹp 0', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      await ret(o.id, u.id, 25);
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual(none);
    });

    it('đơn đã hết khoá không kéo lockedUntil; đơn khác còn khoá giữ lockedUntil của nó', async () => {
      const u = await createUser(prisma);
      const zero = await deliveredWithPoints(u.id, 20, 0.1);
      await ret(zero.id, u.id, 20);
      const other = await deliveredWithPoints(u.id, 10, 3);
      const r = await loyalty.lockedOrderPoints(u.id, new Date());
      expect(r.locked).toBe(10);
      expect(r.lockedUntil?.getTime()).toBe((other.deliveredAt as Date).getTime() + 7 * DAY);
    });

    it('yêu cầu REQUESTED đang chờ vẫn là pendingReturn (phần còn lại vào lockedReturn, không kéo lockedUntil)', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      await ret(o.id, u.id, 8);
      await ret(o.id, u.id, 0, 'REQUESTED');
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual({ locked: 12, lockedReturn: 12, lockedUntil: null });
    });

    it('REQUESTED chưa duyệt không trừ điểm khoá', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      await ret(o.id, u.id, 8, 'REQUESTED');
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual({ locked: 20, lockedReturn: 20, lockedUntil: null });
    });

    it('sau cửa sổ → như cũ (không khoá)', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20, 10);
      await ret(o.id, u.id, 8);
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual(none);
    });

    it('đơn đã ORDER_REVERSED → như cũ (loại hẳn)', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20);
      await ret(o.id, u.id, 8);
      await prisma.pointsTransaction.create({
        data: { userId: u.id, delta: -12, lot: 'STANDARD', reason: `ORDER_REVERSED:${o.code}`, refType: 'ORDER', refId: o.id },
      });
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual(none);
    });

    it('đơn không còn DELIVERED vẫn là pendingReturn, trừ phần đã thu hồi', async () => {
      const u = await createUser(prisma);
      const o = await deliveredWithPoints(u.id, 20, 30);
      await ret(o.id, u.id, 8);
      await prisma.order.update({ where: { id: o.id }, data: { status: 'RETURNED' } });
      expect(await loyalty.lockedOrderPoints(u.id, new Date())).toEqual({ locked: 12, lockedReturn: 12, lockedUntil: null });
    });
  });
});
