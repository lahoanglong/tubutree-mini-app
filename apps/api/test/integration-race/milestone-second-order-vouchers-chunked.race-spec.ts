import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser, warmPool } from './helpers';

/** milestoneVouchers / secondOrderVouchers xử lý lô song song (tối đa 10): đủ số coupon đúng mức, chạy lại và 2 instance không trùng. */
describe('VouchersService milestone + second-order chunked (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;

  const DAY = 864e5;
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const phoneUser = () => createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
  const couponsOf = (prefix: string, userIds: string[]) =>
    prisma.coupon.findMany({
      where: { code: { startsWith: prefix }, OR: userIds.map((id) => ({ scopeMeta: { path: ['userId'], equals: id } })) },
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(SystemConfigService);
    await warmPool(prisma);
  });

  beforeEach(() => notify.mockClear());

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('milestone: 25 khách chi tiêu nhiều mức qua nhiều trang (trang 7), mỗi người đạt mốc đúng 1 coupon đúng mức; 2 instance song song + chạy lại không tạo thêm', async () => {
    const statics = VouchersService as unknown as { MILESTONE_PAGE: number };
    const original = statics.MILESTONE_PAGE;
    statics.MILESTONE_PAGE = 7;
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      // createdAt = bây giờ để đơn luôn nằm trong tháng VN hiện tại (kỳ tính của cron), kể cả ngày đầu tháng; giao 8 ngày trước
      // để đã qua hạn đổi/trả 7 ngày, điều kiện để đơn được tính.
      const tiers = [
        { spent: 6_000_000, reward: 200_000 },
        { spent: 3_500_000, reward: 100_000 },
        { spent: 1_200_000, reward: 30_000 },
        { spent: 500_000, reward: null },
      ];
      const mine: { id: string; reward: number | null }[] = [];
      for (let i = 0; i < 25; i++) {
        const t = tiers[i % tiers.length]!;
        const u = await phoneUser();
        await createOrder(prisma, { userId: u.id, status: 'DELIVERED', total: t.spent, subtotal: t.spent, createdAt: new Date(), deliveredAt: ago(8) });
        mine.push({ id: u.id, reward: t.reward });
      }
      const ids = mine.map((m) => m.id);

      await Promise.all([
        new VouchersService(prisma, config, notifications).milestoneVouchers(),
        new VouchersService(prisma, config, notifications).milestoneVouchers(),
      ]);
      const first = await couponsOf('MILESTONE', ids);
      await new VouchersService(prisma, config, notifications).milestoneVouchers();
      const second = await couponsOf('MILESTONE', ids);

      const eligible = mine.filter((m) => m.reward !== null);
      expect(first).toHaveLength(eligible.length);
      expect(second.map((c) => c.id).sort()).toEqual(first.map((c) => c.id).sort());
      for (const m of mine) {
        const c = first.filter((x) => (x.scopeMeta as { userId: string }).userId === m.id);
        expect(c).toHaveLength(m.reward === null ? 0 : 1);
        if (m.reward !== null) expect(c[0]!.value).toBe(m.reward);
      }
      const notified = notify.mock.calls.filter((c: unknown[]) => c[1] === 'MILESTONE_VOUCHER' && ids.includes(c[0] as string));
      expect(notified).toHaveLength(eligible.length);
      // Hai instance đua cùng mã: P2002 phải được coi là đã cấp, không thành lỗi.
      expect(errorLog.mock.calls.filter((c) => String(c[0]).includes('lỗi'))).toHaveLength(0);
    } finally {
      statics.MILESTONE_PAGE = original;
      errorLog.mockRestore();
    }
  });

  it('second-order: 25 khách một đơn đã giao qua nhiều trang (trang 7): mỗi người đúng 1 mã hạn theo đơn đầu; 2 instance song song + chạy lại không tạo thêm', async () => {
    const statics = VouchersService as unknown as { SECOND_ORDER_PAGE: number };
    const original = statics.SECOND_ORDER_PAGE;
    statics.SECOND_ORDER_PAGE = 7;
    try {
      const mine: { id: string; createdAt: Date }[] = [];
      for (let i = 0; i < 25; i++) {
        const u = await phoneUser();
        const o = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', createdAt: ago(8), deliveredAt: ago(4) });
        mine.push({ id: u.id, createdAt: o.createdAt });
      }
      const ids = mine.map((m) => m.id);

      await Promise.all([
        new VouchersService(prisma, config, notifications).secondOrderVouchers(),
        new VouchersService(prisma, config, notifications).secondOrderVouchers(),
      ]);
      const first = await couponsOf('SECOND-ORDER-', ids);
      await new VouchersService(prisma, config, notifications).secondOrderVouchers();
      const second = await couponsOf('SECOND-ORDER-', ids);

      expect(first).toHaveLength(25);
      expect(second.map((c) => c.id).sort()).toEqual(first.map((c) => c.id).sort());
      for (const m of mine) {
        const c = first.filter((x) => (x.scopeMeta as { userId: string }).userId === m.id);
        expect(c).toHaveLength(1);
        expect(c[0]!.code).toBe(`SECOND-ORDER-${m.id}`.toUpperCase());
        expect(Math.abs(c[0]!.endAt.getTime() - (m.createdAt.getTime() + 30 * DAY))).toBeLessThan(1000);
      }
      const notified = notify.mock.calls.filter((c: unknown[]) => c[1] === 'SECOND_ORDER_VOUCHER' && ids.includes(c[0] as string));
      expect(notified).toHaveLength(25);
    } finally {
      statics.SECOND_ORDER_PAGE = original;
    }
  });
});
