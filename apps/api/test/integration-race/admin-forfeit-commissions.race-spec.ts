import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

describe('Huỷ hoa hồng chờ rút của CTV bị thu hồi chạy song song với rút, cron Ví và cấp lại quyền (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let admin: AdminService;
  let boss: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    const rbac = new RbacService(prisma, fulfilment);
    const none = {} as never;
    const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined) } as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, rbac, none, none, fulfilment);
    boss = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const newPhone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  /** CTV có 1 hoa hồng APPROVED 100k; `revoked` thì đã bị admin hạ về khách (có dấu) qua setUserRole thật. */
  async function ctv(revoked: boolean) {
    const phone = newPhone();
    const user = await createUser(prisma, { role: 'AFFILIATE', phone });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: user.id, total: 1_000_000 });
    const commission = await prisma.commission.create({
      data: {
        affiliateUserId: user.id,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: order.total,
        rate: 10,
        amount: 100_000,
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
    if (revoked) await admin.setUserRole(boss.id, phone, 'CUSTOMER');
    return { user, phone, commission };
  }

  const snapshot = async (userId: string, commissionId: string) => {
    const [u, c, forfeits, ledger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.commission.findUniqueOrThrow({ where: { id: commissionId }, select: { status: true } }),
      prisma.userAdminEvent.count({ where: { userId, kind: 'COMMISSION_FORFEIT' } }),
      prisma.walletTransaction.count({ where: { userId, type: 'COMMISSION_PAYOUT' } }),
    ]);
    return { balance: u.walletBalance, status: c.status, forfeits, ledger };
  };

  it('người có dấu: huỷ thành công, hoa hồng REJECTED, Ví không đổi, sổ có COMMISSION_FORFEIT kèm lý do và người làm', async () => {
    const { user, commission } = await ctv(true);
    await expect(admin.forfeitRevokedCommissions(boss.id, user.id, 'Quyết định của quản lý')).resolves.toEqual({ cancelled: 1, amount: 100_000 });
    expect(await snapshot(user.id, commission.id)).toEqual({ balance: 0, status: 'REJECTED', forfeits: 1, ledger: 0 });
    const ev = await prisma.userAdminEvent.findFirstOrThrow({ where: { userId: user.id, kind: 'COMMISSION_FORFEIT' } });
    expect(ev).toMatchObject({ fromValue: '100000', toValue: '0', actorId: boss.id });
    expect(ev.reason).toContain('Quyết định của quản lý');
  });

  it('người không có dấu: 409 và hoa hồng giữ nguyên APPROVED', async () => {
    const { user, commission } = await ctv(false);
    await expect(admin.forfeitRevokedCommissions(boss.id, user.id, 'thử huỷ')).rejects.toBeInstanceOf(ConflictException);
    expect(await snapshot(user.id, commission.id)).toEqual({ balance: 0, status: 'APPROVED', forfeits: 0, ledger: 0 });
  });

  it('hai admin hai tab cùng bấm huỷ: đúng một bên thành công, bên kia 409, chỉ một dòng sổ', async () => {
    for (let i = 0; i < 10; i++) {
      const { user, commission } = await ctv(true);
      const results = await Promise.allSettled([
        admin.forfeitRevokedCommissions(boss.id, user.id, 'tab thứ nhất'),
        admin.forfeitRevokedCommissions(boss.id, user.id, 'tab thứ hai'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      expect(await snapshot(user.id, commission.id)).toEqual({ balance: 0, status: 'REJECTED', forfeits: 1, ledger: 0 });
    }
  });

  it('huỷ chạy cùng rút tay và cron chuyển Ví trên người có dấu: rút bị 403, cron bỏ qua, tiền không vào Ví', async () => {
    for (let i = 0; i < 10; i++) {
      const { user, commission } = await ctv(true);
      const [forfeit, payout] = await Promise.allSettled([
        admin.forfeitRevokedCommissions(boss.id, user.id, 'huỷ khi đang rút'),
        affiliate.requestPayout(user.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`),
        affiliate.autoTransferApprovedToWallet(),
      ]);
      expect(forfeit.status).toBe('fulfilled');
      expect((payout as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
      expect(await snapshot(user.id, commission.id)).toEqual({ balance: 0, status: 'REJECTED', forfeits: 1, ledger: 0 });
    }
  });

  it('huỷ đua với admin cấp lại CTV, rút tay và cron: hoặc huỷ thắng (REJECTED, Ví 0) hoặc cấp lại thắng (huỷ 409, tiền không bị mất), không bao giờ vừa huỷ vừa vào Ví', async () => {
    let cancelled = 0;
    let kept = 0;
    for (let i = 0; i < 20; i++) {
      const { user, phone, commission } = await ctv(true);
      const [forfeit] = await Promise.allSettled([
        admin.forfeitRevokedCommissions(boss.id, user.id, 'đua với cấp lại'),
        admin.setUserRole(boss.id, phone, 'AFFILIATE'),
        affiliate.requestPayout(user.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`).catch(() => undefined),
        affiliate.autoTransferApprovedToWallet(),
      ]);
      const s = await snapshot(user.id, commission.id);
      if (forfeit.status === 'fulfilled') {
        cancelled++;
        expect(s).toEqual({ balance: 0, status: 'REJECTED', forfeits: 1, ledger: 0 });
      } else {
        kept++;
        expect(forfeit.reason).toBeInstanceOf(ConflictException);
        expect(s.forfeits).toBe(0);
        expect(['APPROVED', 'PAID']).toContain(s.status);
        expect(s.status === 'PAID' ? { balance: s.balance, ledger: s.ledger } : { balance: 0, ledger: 0 }).toEqual({ balance: s.status === 'PAID' ? 100_000 : 0, ledger: s.status === 'PAID' ? 1 : 0 });
      }
    }
    expect(cancelled + kept).toBe(20);
  });

  // Bất biến (không phải ca đua): chỉ khoản APPROVED chưa vào lệnh nào mới bị huỷ. Khoản đã gom vào lệnh rút (payoutBatchId) hay đã PAID
  // thuộc về luồng chi tiền, huỷ ở đây là mất tiền đã chuyển. Ca đua thật của đường nhanh `assertNotRevoked` nằm ở các ca bên trên (tới phần tx).
  it('bất biến: khoản đã gom vào lệnh rút (payoutBatchId) và khoản PAID không bị huỷ, chỉ khoản tự do bị huỷ', async () => {
    const { user, commission } = await ctv(true);
    const mk = async (status: 'APPROVED' | 'PAID', payoutBatchId: string | null) => {
      const buyer = await createUser(prisma);
      const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: user.id, total: 500_000 });
      return prisma.commission.create({
        data: { affiliateUserId: user.id, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total, rate: 10, amount: 50_000, status, lockedAt: new Date(Date.now() - 30 * 864e5), approvedAt: new Date(), payoutBatchId, paidAt: status === 'PAID' ? new Date() : null },
      });
    };
    const inBatch = await mk('APPROVED', 'batch-x');
    const paid = await mk('PAID', 'batch-y');
    await expect(admin.forfeitRevokedCommissions(boss.id, user.id, 'chỉ huỷ khoản tự do')).resolves.toEqual({ cancelled: 1, amount: 100_000 });
    const status = async (id: string) => (await prisma.commission.findUniqueOrThrow({ where: { id }, select: { status: true, payoutBatchId: true } }));
    expect(await status(commission.id)).toMatchObject({ status: 'REJECTED' });
    expect(await status(inBatch.id)).toEqual({ status: 'APPROVED', payoutBatchId: 'batch-x' });
    expect(await status(paid.id)).toEqual({ status: 'PAID', payoutBatchId: 'batch-y' });
  });

  // m5: huỷ về REJECTED như huỷ đơn/trả hàng nên mốc thưởng tháng đã nhận mà doanh số nay dưới ngưỡng phải bị thu hồi.
  it('huỷ làm doanh số tháng về 0: điểm thưởng mốc đã nhận bị thu hồi cùng giao dịch', async () => {
    const phone = newPhone();
    const user = await createUser(prisma, { role: 'AFFILIATE', phone });
    for (const amount of [2_200_000, 8_000_000]) {
      const buyer = await createUser(prisma);
      const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: user.id, total: amount });
      await prisma.commission.create({
        data: { affiliateUserId: user.id, orderId: order.id, orderTotal: amount, commissionableTotal: amount, rate: 10, amount: amount / 10, status: 'APPROVED', lockedAt: new Date(Date.now() - 30 * 864e5), approvedAt: new Date() },
      });
    }
    await affiliate.claimMilestone(user.id, 'milestone-3m');
    await affiliate.claimMilestone(user.id, 'milestone-10m');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(250_000);
    await admin.setUserRole(boss.id, phone, 'CUSTOMER');
    await admin.forfeitRevokedCommissions(boss.id, user.id, 'huỷ theo quyết định');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(0);
    const claims = await prisma.ctvMilestoneClaim.findMany({ where: { userId: user.id } });
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.revokedAt !== null)).toBe(true);
  });
});
