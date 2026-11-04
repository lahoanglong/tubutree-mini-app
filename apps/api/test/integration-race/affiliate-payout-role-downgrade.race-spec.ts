import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { CTV_MONTHLY_MILESTONES } from '../../src/modules/affiliate/ctv-milestones';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import type { Prisma } from '@prisma/client';
import { createOrder, createUser, randCode, sleep, warmPool } from './helpers';

describe('Hạ quyền CTV chạy song song với rút hoa hồng về Ví (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

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
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function ctvWithCommission(amount: number) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: ctv.id, total: amount * 10 });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: order.total,
        rate: 10,
        amount,
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
    return ctv;
  }

  const newPhone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  function adminServices() {
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    const rbac = new RbacService(prisma, fulfilment);
    const none = {} as never;
    const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined) } as never;
    return { rbac, admin: new AdminService(prisma, none, none, none, notifications, none, none, rbac, none, none, fulfilment) };
  }
  const markOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).affiliateRevokedAt;
  const BACKFILL_SQL = readFileSync(join(__dirname, '../../prisma/migrations/20261104160500_user_affiliate_revoked_backfill/migration.sql'), 'utf8');

  class Rollback extends Error {}
  /** Chạy trong giao dịch rồi huỷ: SQL backfill quét cả DB nên không được để lại dấu cho người dùng của spec khác. */
  async function rolledBack<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let out!: T;
    await prisma
      .$transaction(async (tx) => {
        out = await fn(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    return out;
  }

  async function state(userId: string) {
    const [u, payouts, paid, approved, ledger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.payout.count({ where: { userId } }),
      prisma.commission.count({ where: { affiliateUserId: userId, status: 'PAID' } }),
      prisma.commission.count({ where: { affiliateUserId: userId, status: 'APPROVED' } }),
      prisma.walletTransaction.findMany({ where: { userId, type: 'COMMISSION_PAYOUT' } }),
    ]);
    return { balance: u.walletBalance, payouts, paid, approved, ledger: ledger.length };
  }

  it('hạ quyền đã giữ khoá dòng người dùng trước khi rút bắt đầu → rút bị 403, Ví và hoa hồng không đổi', async () => {
    const ctv = await ctvWithCommission(100_000);
    const downgrade = prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER', affiliateRevokedAt: new Date() } });
      await sleep(400);
    });
    await sleep(100);
    const payout = affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    const [, res] = await Promise.allSettled([downgrade, payout]);
    expect(res.status).toBe('rejected');
    expect((res as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(await state(ctv.id)).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
  });

  it('rút và hạ quyền đua nhau 20 vòng: kết quả luôn nhất quán, rút thắng thì đúng một lần', async () => {
    for (let i = 0; i < 20; i++) {
      const ctv = await ctvWithCommission(100_000);
      const [res] = await Promise.all([
        Promise.allSettled([affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)]).then((r) => r[0]),
        prisma.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER', affiliateRevokedAt: new Date() } }),
      ]);
      const s = await state(ctv.id);
      if (res.status === 'fulfilled') {
        expect(s).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
      } else {
        expect(res.reason).toBeInstanceOf(ForbiddenException);
        expect(s).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
      }
    }
  });

  it('hạ về khách có dấu: đăng ký lại 403, rút 403; admin cấp lại CTV (xoá dấu) thì rút được', async () => {
    const ctv = await ctvWithCommission(100_000);
    await prisma.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER', affiliateRevokedAt: new Date() } });
    await expect(affiliate.register(ctv.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await affiliate.getMe(ctv.id)).canRegister).toBe(false);
    await expect(affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.user.update({ where: { id: ctv.id }, data: { role: 'AFFILIATE', affiliateRevokedAt: null } });
    await affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    expect(await state(ctv.id)).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
  });

  it('CTV được nâng nhân viên (không dấu) vẫn rút được hoa hồng đã duyệt', async () => {
    const ctv = await ctvWithCommission(100_000);
    await prisma.user.update({ where: { id: ctv.id }, data: { role: 'STAFF' } });
    await affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    expect(await state(ctv.id)).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
  });

  it('claimMilestone: có dấu thu hồi → 403 trước khi tính doanh số', async () => {
    const ctv = await ctvWithCommission(100_000);
    await prisma.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER', affiliateRevokedAt: new Date() } });
    await expect(affiliate.claimMilestone(ctv.id, CTV_MONTHLY_MILESTONES[0].id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('khách (CUSTOMER) còn hoa hồng APPROVED nhưng KHÔNG có dấu (hạ trước khi có cột) → rút 403, nhận thưởng mốc 403', async () => {
    const ctv = await ctvWithCommission(100_000);
    await prisma.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER' } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ctv.id } })).affiliateRevokedAt).toBeNull();
    await expect(affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(affiliate.claimMilestone(ctv.id, CTV_MONTHLY_MILESTONES[0].id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await state(ctv.id)).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
  });

  it('đại lý bị admin hạ về khách (có dấu) → cấp rồi thu hồi nhân viên về DEALER (đơn còn APPROVED): dấu còn nguyên, rút vẫn 403', async () => {
    const created = await ctvWithCommission(100_000);
    const boss = await createUser(prisma, { role: 'ADMIN' });
    const dealer = await prisma.user.update({ where: { id: created.id }, data: { role: 'DEALER', phone: newPhone() } });
    await prisma.dealerApplication.create({
      data: { userId: dealer.id, status: 'APPROVED', businessName: 'IT', ownerName: 'IT', phone: dealer.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
    });
    const { rbac, admin } = adminServices();
    const mark = () => markOf(dealer.id);

    await admin.setUserRole(boss.id, dealer.phone!, 'CUSTOMER');
    expect(await mark()).not.toBeNull();
    await rbac.addGrant(boss.id, dealer.phone!, 'STAFF');
    expect(await mark()).not.toBeNull();
    await rbac.revokeGrant(boss.id, dealer.phone!);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: dealer.id } });
    expect(after.role).toBe('DEALER');
    expect(after.affiliateRevokedAt).not.toBeNull();
    await expect(affiliate.requestPayout(dealer.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await state(dealer.id)).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
  });

  it('M1: CTV bị hạ (có dấu) nộp hồ sơ đại lý rồi được duyệt → DEALER nhưng dấu còn, rút 403; admin đặt lại DEALER tường minh mới xoá dấu và rút được', async () => {
    const created = await ctvWithCommission(100_000);
    const phone = newPhone();
    await prisma.user.update({ where: { id: created.id }, data: { phone } });
    const boss = await createUser(prisma, { role: 'ADMIN' });
    const { admin } = adminServices();
    await admin.setUserRole(boss.id, phone, 'CUSTOMER');
    expect(await markOf(created.id)).not.toBeNull();
    const tier = await prisma.dealerTier.create({ data: { id: `tier-${randCode(6)}`, name: 'T', minOrderVolume: 0, discountRules: {} } });
    const app = await prisma.dealerApplication.create({
      data: { userId: created.id, status: 'PENDING', businessName: 'IT', ownerName: 'IT', phone, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
    });
    await admin.reviewDealerApplication(boss.id, app.id, true, tier.id);
    const approved = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(approved.role).toBe('DEALER');
    expect(approved.affiliateRevokedAt).not.toBeNull();
    await expect(affiliate.requestPayout(created.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await state(created.id)).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });

    await admin.setUserRole(boss.id, phone, 'DEALER', tier.id);
    expect(await markOf(created.id)).toBeNull();
    await affiliate.requestPayout(created.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    expect(await state(created.id)).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
  });

  it('m1: CTV hợp lệ được cấp rồi thu hồi nhân viên → CUSTOMER không dấu, tự đăng ký lại CTV được và rút được', async () => {
    const ctv = await ctvWithCommission(100_000);
    const phone = newPhone();
    await prisma.user.update({ where: { id: ctv.id }, data: { phone } });
    const boss = await createUser(prisma, { role: 'ADMIN' });
    const { rbac } = adminServices();
    await rbac.addGrant(boss.id, phone, 'STAFF');
    await rbac.revokeGrant(boss.id, phone);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ctv.id } });
    expect(after.role).toBe('CUSTOMER');
    expect(after.affiliateRevokedAt).toBeNull();
    await affiliate.register(ctv.id);
    await affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    expect(await state(ctv.id)).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
  });

  it('A1: hạ CTV rồi đặt lại cùng vai trò đại lý (dấu còn) → sổ có đúng 2 dòng AFFILIATE_REVOKE theo thứ tự đặt rồi xoá', async () => {
    const created = await ctvWithCommission(100_000);
    const phone = newPhone();
    await prisma.user.update({ where: { id: created.id }, data: { phone } });
    const boss = await createUser(prisma, { role: 'ADMIN' });
    const tier = await prisma.dealerTier.create({ data: { id: `tier-${randCode(6)}`, name: 'T', minOrderVolume: 0, discountRules: {} } });
    const { admin } = adminServices();
    await admin.setUserRole(boss.id, phone, 'CUSTOMER');
    await prisma.user.update({ where: { id: created.id }, data: { role: 'DEALER' } });
    expect(await markOf(created.id)).not.toBeNull();
    await admin.setUserRole(boss.id, phone, 'DEALER', tier.id);
    expect(await markOf(created.id)).toBeNull();
    const rows = await prisma.userAdminEvent.findMany({ where: { userId: created.id, kind: 'AFFILIATE_REVOKE' }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.fromValue === null, r.toValue === null, r.actorId])).toEqual([
      [true, false, boss.id],
      [false, true, boss.id],
    ]);
  });

  it('migration backfill: đặt dấu cho khách có dấu vết CTV, bỏ qua khách thường và CTV đang hoạt động; chạy lại không đổi', async () => {
    const withCommission = await ctvWithCommission(50_000);
    await prisma.user.update({ where: { id: withCommission.id }, data: { role: 'CUSTOMER' } });
    const withStorefront = await createUser(prisma, { role: 'CUSTOMER' });
    await prisma.storefront.create({ data: { type: 'CTV', slug: `bf-${randCode(8)}`, title: 'bf', ownerUserId: withStorefront.id } });
    const withEvent = await createUser(prisma, { role: 'CUSTOMER' });
    await prisma.userAdminEvent.create({ data: { userId: withEvent.id, kind: 'ROLE', fromValue: 'AFFILIATE', toValue: 'CUSTOMER' } });
    const plain = await createUser(prisma, { role: 'CUSTOMER' });
    const active = await ctvWithCommission(50_000);
    const ids = [withCommission.id, withStorefront.id, withEvent.id, plain.id, active.id];
    const result = await rolledBack(async (tx) => {
      const marks = async () =>
        Object.fromEntries((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, affiliateRevokedAt: true } })).map((u) => [u.id, u.affiliateRevokedAt]));
      await tx.$executeRawUnsafe(BACKFILL_SQL);
      const first = await marks();
      await tx.$executeRawUnsafe(BACKFILL_SQL);
      return { first, second: await marks() };
    });
    expect(Object.fromEntries(Object.entries(result.first).map(([k, v]) => [k, v !== null]))).toEqual({
      [withCommission.id]: true,
      [withStorefront.id]: true,
      [withEvent.id]: true,
      [plain.id]: false,
      [active.id]: false,
    });
    expect(result.second).toEqual(result.first);
    expect(await markOf(withCommission.id)).toBeNull();
  });

  it('backfill với cấu hình cho khách hưởng hoa hồng: khách chỉ có hoa hồng không bị đánh dấu, người có lịch sử hạ quyền vẫn bị', async () => {
    const onlyCommission = await ctvWithCommission(40_000);
    await prisma.user.update({ where: { id: onlyCommission.id }, data: { role: 'CUSTOMER' } });
    const demoted = await createUser(prisma, { role: 'CUSTOMER' });
    await prisma.userAdminEvent.create({ data: { userId: demoted.id, kind: 'ROLE', fromValue: 'DEALER', toValue: 'CUSTOMER' } });
    const key = 'affiliate.commission_eligible_roles';
    const marks = await rolledBack(async (tx) => {
      await tx.systemConfig.upsert({
        where: { key },
        update: { value: ['AFFILIATE', 'DEALER', 'CUSTOMER'] },
        create: { key, value: ['AFFILIATE', 'DEALER', 'CUSTOMER'], category: 'affiliate' },
      });
      await tx.$executeRawUnsafe(BACKFILL_SQL);
      return (await tx.user.findMany({ where: { id: { in: [onlyCommission.id, demoted.id] } }, select: { id: true, affiliateRevokedAt: true } })).map((u) => [u.id, u.affiliateRevokedAt !== null] as const);
    });
    expect(Object.fromEntries(marks)).toEqual({ [onlyCommission.id]: false, [demoted.id]: true });
  });

  it('m2 backfill: đại lý từng bị hạ về khách rồi về lại DEALER qua nhân viên (trạng thái trước deploy) bị đặt dấu; đại lý được admin đặt lại tường minh thì không', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN' });
    const { admin, rbac } = adminServices();
    const app = (userId: string, phone: string) =>
      prisma.dealerApplication.create({ data: { userId, status: 'APPROVED', businessName: 'IT', ownerName: 'IT', phone, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' } });
    const tier = await prisma.dealerTier.create({ data: { id: `tier-${randCode(6)}`, name: 'T', minOrderVolume: 0, discountRules: {} } });
    const dealerUser = async () => {
      const phone = newPhone();
      const u = await createUser(prisma, { role: 'DEALER', phone });
      await app(u.id, phone);
      return { u, phone };
    };

    const viaStaff = await dealerUser();
    await admin.setUserRole(boss.id, viaStaff.phone, 'CUSTOMER');
    await rbac.addGrant(boss.id, viaStaff.phone, 'STAFF');
    await rbac.revokeGrant(boss.id, viaStaff.phone);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: viaStaff.u.id } })).role).toBe('DEALER');
    await prisma.user.update({ where: { id: viaStaff.u.id }, data: { affiliateRevokedAt: null } });

    const reinstated = await dealerUser();
    await admin.setUserRole(boss.id, reinstated.phone, 'CUSTOMER');
    await admin.setUserRole(boss.id, reinstated.phone, 'DEALER', tier.id);
    await prisma.user.update({ where: { id: reinstated.u.id }, data: { affiliateRevokedAt: null } });

    const healthy = await dealerUser();

    const marks = await rolledBack(async (tx) => {
      await tx.$executeRawUnsafe(BACKFILL_SQL);
      return (await tx.user.findMany({ where: { id: { in: [viaStaff.u.id, reinstated.u.id, healthy.u.id] } }, select: { id: true, affiliateRevokedAt: true } })).map((u) => [u.id, u.affiliateRevokedAt !== null] as const);
    });
    expect(Object.fromEntries(marks)).toEqual({ [viaStaff.u.id]: true, [reinstated.u.id]: false, [healthy.u.id]: false });
  });
  describe('backfill phát lại đúng điều mã mới sẽ làm (sự kiện ROLE gần nhất của setUserRole quyết định)', () => {
    async function ctvWithPhone() {
      const ctv = await ctvWithCommission(60_000);
      const phone = newPhone();
      await prisma.user.update({ where: { id: ctv.id }, data: { phone } });
      return { id: ctv.id, phone };
    }
    /** Giả lập trạng thái trước deploy: mã cũ chưa có cột nên không dấu nào còn lại. */
    const preDeploy = (id: string) => prisma.user.update({ where: { id }, data: { affiliateRevokedAt: null } });
    async function markedAfterBackfill(ids: string[]) {
      const marks = await rolledBack(async (tx) => {
        await tx.$executeRawUnsafe(BACKFILL_SQL);
        return (await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, affiliateRevokedAt: true } })).map((u) => [u.id, u.affiliateRevokedAt !== null] as const);
      });
      return Object.fromEntries(marks);
    }

    it('B: CTV hạ về khách rồi lên nhân viên qua setUserRole hoặc addGrant → có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin, rbac } = adminServices();
      const viaSetRole = await ctvWithPhone();
      await admin.setUserRole(boss.id, viaSetRole.phone, 'CUSTOMER');
      await admin.setUserRole(boss.id, viaSetRole.phone, 'STAFF');
      const viaGrant = await ctvWithPhone();
      await admin.setUserRole(boss.id, viaGrant.phone, 'CUSTOMER');
      await rbac.addGrant(boss.id, viaGrant.phone, 'STAFF');
      for (const u of [viaSetRole, viaGrant]) {
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('STAFF');
        await preDeploy(u.id);
      }
      expect(await markedAfterBackfill([viaSetRole.id, viaGrant.id])).toEqual({ [viaSetRole.id]: true, [viaGrant.id]: true });
    });

    it('A: CTV tốt được cấp rồi thu hồi nhân viên → về khách nhưng KHÔNG có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { rbac } = adminServices();
      const good = await ctvWithPhone();
      await rbac.addGrant(boss.id, good.phone, 'STAFF');
      await rbac.revokeGrant(boss.id, good.phone);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: good.id } })).role).toBe('CUSTOMER');
      expect(await markedAfterBackfill([good.id])).toEqual({ [good.id]: false });
    });

    it('hạ rồi cấp lại CTV bằng setUserRole, sau đó cấp và thu hồi nhân viên → sự kiện gần nhất là cấp lại nên KHÔNG có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin, rbac } = adminServices();
      const u = await ctvWithPhone();
      await admin.setUserRole(boss.id, u.phone, 'CUSTOMER');
      await admin.setUserRole(boss.id, u.phone, 'AFFILIATE');
      await rbac.addGrant(boss.id, u.phone, 'STAFF');
      await rbac.revokeGrant(boss.id, u.phone);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('CUSTOMER');
      expect(await markedAfterBackfill([u.id])).toEqual({ [u.id]: false });
    });

    it('nhân viên có dấu vết CTV bị hạ về khách bằng setUserRole → có dấu; nhân viên chưa từng bán thì không', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin } = adminServices();
      const seller = await ctvWithPhone();
      await prisma.user.update({ where: { id: seller.id }, data: { role: 'STAFF' } });
      await admin.setUserRole(boss.id, seller.phone, 'CUSTOMER');
      const plainPhone = newPhone();
      const plain = await createUser(prisma, { role: 'STAFF', phone: plainPhone });
      await admin.setUserRole(boss.id, plainPhone, 'CUSTOMER');
      await preDeploy(seller.id);
      expect(await markedAfterBackfill([seller.id, plain.id])).toEqual({ [seller.id]: true, [plain.id]: false });
    });

    it('nhân viên chưa từng bán bị hạ về khách, sau đó tự đăng ký CTV và có hoa hồng → dấu vết sinh SAU sự kiện không tính, KHÔNG có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin } = adminServices();
      const phone = newPhone();
      const u = await createUser(prisma, { role: 'STAFF', phone });
      await admin.setUserRole(boss.id, phone, 'CUSTOMER');
      expect(await markOf(u.id)).toBeNull();
      await affiliate.register(u.id);
      const buyer = await createUser(prisma);
      const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: u.id, total: 500_000 });
      await prisma.commission.create({
        data: { affiliateUserId: u.id, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total, rate: 10, amount: 50_000, status: 'APPROVED', lockedAt: new Date(), approvedAt: new Date() },
      });
      await prisma.storefront.create({ data: { type: 'CTV', slug: `late-${randCode(8)}`, title: 'late', ownerUserId: u.id } });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('AFFILIATE');
      expect(await markedAfterBackfill([u.id])).toEqual({ [u.id]: false });
    });

    it('nhân viên đã có gian hàng CTV trước lúc bị hạ về khách → có dấu (dấu vết tồn tại tại thời điểm sự kiện)', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin } = adminServices();
      const phone = newPhone();
      const u = await createUser(prisma, { role: 'STAFF', phone });
      await prisma.storefront.create({ data: { type: 'CTV', slug: `early-${randCode(8)}`, title: 'early', ownerUserId: u.id } });
      await admin.setUserRole(boss.id, phone, 'CUSTOMER');
      await preDeploy(u.id);
      expect(await markedAfterBackfill([u.id])).toEqual({ [u.id]: true });
    });

    it('nhân viên có gian hàng đối tác (MERCHANT) bị hạ về khách: gian hàng chuyển sang CTV trong cùng lệnh, tạo từ trước → có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin } = adminServices();
      const phone = newPhone();
      const u = await createUser(prisma, { role: 'STAFF', phone });
      const store = await prisma.storefront.create({ data: { type: 'MERCHANT', isPartner: true, slug: `mch-${randCode(8)}`, title: 'mch', ownerUserId: u.id } });
      await admin.setUserRole(boss.id, phone, 'CUSTOMER');
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).type).toBe('CTV');
      await preDeploy(u.id);
      expect(await markedAfterBackfill([u.id])).toEqual({ [u.id]: true });
    });

    it('CTV hạ về khách rồi tự đăng ký lại (role AFFILIATE, không có sự kiện ROLE sau lần hạ) → có dấu', async () => {
      const boss = await createUser(prisma, { role: 'ADMIN' });
      const { admin } = adminServices();
      const u = await ctvWithPhone();
      await admin.setUserRole(boss.id, u.phone, 'CUSTOMER');
      await prisma.user.update({ where: { id: u.id }, data: { role: 'AFFILIATE', affiliateRevokedAt: null } });
      expect(await markedAfterBackfill([u.id])).toEqual({ [u.id]: true });
    });
  });
});
