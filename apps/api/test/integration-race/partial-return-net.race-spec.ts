import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser } from './helpers';

/**
 * Sau trả hàng MỘT PHẦN (đơn vẫn DELIVERED): voucher mốc tính theo chi tiêu RÒNG
 * (total trừ tiền hàng + ship đã hoàn của yêu cầu APPROVED, fullReturn=false).
 */
describe('trả một phần: voucher mốc (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let vouchers: VouchersService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        VouchersService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    vouchers = moduleRef.get(VouchersService);
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
});
