import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { UserBlockService } from '../../src/modules/admin/user-block.service';
import { SessionStateService } from '../../src/modules/auth/session-state.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createUser, warmPool } from './helpers';

/**
 * R4-ADMIN-6 trên Postgres THẬT: hai quản trị viên cuối cùng cùng lúc hạ quyền / thu hồi / khoá nhau thì chỉ một
 * thao tác được qua — hệ thống luôn còn ít nhất một ADMIN đang hoạt động (không bị khoá). Trước đây mỗi request đếm
 * admin rồi mới ghi, không khoá: cả hai cùng thấy "còn 2 admin", cả hai cùng 201, số admin về 0.
 */
describe('Quản trị viên cuối cùng an toàn khi đồng thời (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let rbac: RbacService;
  let blocks: UserBlockService;
  /** ADMIN do race spec khác tạo: tạm hạ STAFF để "hai admin cuối cùng" là của spec này, trả lại ở afterAll. */
  let parked: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma));
    rbac = new RbacService(prisma, fulfilment);
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, rbac, none, none, fulfilment);
    blocks = new UserBlockService(prisma, new SessionStateService(prisma));
    const others = await prisma.user.findMany({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true } });
    parked = others.map((u) => u.id);
    if (parked.length) await prisma.user.updateMany({ where: { id: { in: parked } }, data: { role: 'STAFF' } });
  });

  afterAll(async () => {
    if (parked.length) await prisma.user.updateMany({ where: { id: { in: parked } }, data: { role: 'ADMIN' } });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const activeAdmins = () => prisma.user.count({ where: { role: 'ADMIN', isBlocked: false } });

  /** Admin do spec này tạo — chỉ những người này bị hạ giữa các vòng. */
  const mine: string[] = [];
  async function newAdmin() {
    const u = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    mine.push(u.id);
    return u;
  }

  /** Hai admin mới; admin còn hoạt động của vòng trước bị hạ để hai người này là cuối cùng. */
  async function lastTwoAdmins() {
    await prisma.user.updateMany({ where: { id: { in: mine }, role: 'ADMIN' }, data: { role: 'CUSTOMER' } });
    const a = await newAdmin();
    const b = await newAdmin();
    expect(await activeAdmins()).toBe(2);
    return { a, b };
  }

  function expectOneWins(results: PromiseSettledResult<unknown>[]) {
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
    expect(String((failed[0]!.reason as Error).message)).toMatch(/quản trị viên cuối cùng/);
  }

  it('hai admin cuối cùng hạ quyền nhau cùng lúc (POST /admin/users/role) → chỉ một người bị hạ, vẫn còn 1 admin', async () => {
    for (let round = 0; round < 8; round++) {
      const { a, b } = await lastTwoAdmins();
      const results = await Promise.allSettled([
        admin.setUserRole(a.id, b.phone!, 'CUSTOMER'),
        admin.setUserRole(b.id, a.phone!, 'CUSTOMER'),
      ]);
      expectOneWins(results);
      expect(await activeAdmins()).toBe(1);
      const events = await prisma.userAdminEvent.count({ where: { userId: { in: [a.id, b.id] }, kind: 'ROLE' } });
      expect(events).toBe(1);
    }
  });

  it('hai admin cuối cùng thu hồi quyền nhau cùng lúc (POST /admin/staff/revoke) → chỉ một bên qua', async () => {
    for (let round = 0; round < 8; round++) {
      const { a, b } = await lastTwoAdmins();
      const results = await Promise.allSettled([rbac.revokeGrant(a.id, b.phone!), rbac.revokeGrant(b.id, a.phone!)]);
      expectOneWins(results);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it('hai admin cuối cùng khoá tài khoản nhau cùng lúc → chỉ một người bị khoá, vẫn còn 1 admin hoạt động', async () => {
    for (let round = 0; round < 8; round++) {
      const { a, b } = await lastTwoAdmins();
      const results = await Promise.allSettled([blocks.block(a.id, b.id, 'thử khoá'), blocks.block(b.id, a.id, 'thử khoá')]);
      expectOneWins(results);
      expect(await activeAdmins()).toBe(1);
      expect(await prisma.user.count({ where: { id: { in: [a.id, b.id] }, isBlocked: true } })).toBe(1);
    }
  });

  it('trộn ba đường: hạ quyền, thu hồi và khoá cùng lúc trên hai admin cuối cùng → vẫn còn 1 admin hoạt động', async () => {
    for (let round = 0; round < 8; round++) {
      const { a, b } = await lastTwoAdmins();
      const ops =
        round % 2 === 0
          ? [admin.setUserRole(a.id, b.phone!, 'STAFF'), blocks.block(b.id, a.id, 'thử khoá')]
          : [rbac.revokeGrant(a.id, b.phone!), admin.setUserRole(b.id, a.phone!, 'CUSTOMER')];
      const results = await Promise.allSettled(ops);
      expectOneWins(results);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it('admin bị khoá không tính là còn quản trị: còn A hoạt động + B bị khoá thì không hạ / khoá được A', async () => {
    const { a, b } = await lastTwoAdmins();
    const c = await newAdmin();
    await blocks.block(a.id, b.id, 'nghỉ việc');
    await expect(admin.setUserRole(c.id, a.phone!, 'CUSTOMER')).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(await activeAdmins()).toBe(1);
    await expect(blocks.block(c.id, c.id, 'x')).rejects.toBeInstanceOf(BadRequestException);
    await prisma.user.update({ where: { id: c.id }, data: { role: 'ADMIN' } });
    await prisma.user.update({ where: { id: a.id }, data: { role: 'ADMIN' } });
    await expect(admin.setUserRole(a.id, c.phone!, 'CUSTOMER')).resolves.toMatchObject({ role: 'CUSTOMER' });
    await expect(admin.setUserRole(c.id, a.phone!, 'CUSTOMER')).rejects.toThrow(/quản trị viên cuối cùng/);
    await expect(blocks.block(b.id, a.id, 'x')).rejects.toThrow(/quản trị viên cuối cùng/);
    expect(await activeAdmins()).toBe(1);
  });

  it('duyệt hồ sơ đại lý của admin cuối cùng (đổi vai trò sang DEALER) cùng lúc admin đó hạ admin kia → vẫn còn 1 admin', async () => {
    const tier = await prisma.dealerTier.create({
      data: { id: `it_last_admin_${Date.now()}`, name: 'IT bậc', minOrderVolume: 0, discountRules: {} },
    });
    for (let round = 0; round < 6; round++) {
      const { a, b } = await lastTwoAdmins();
      const app = await prisma.dealerApplication.create({
        data: { userId: a.id, businessName: 'IT', ownerName: 'IT', phone: a.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
      });
      const results = await Promise.allSettled([
        admin.reviewDealerApplication(b.id, app.id, true, tier.id),
        admin.setUserRole(a.id, b.phone!, 'CUSTOMER'),
      ]);
      expectOneWins(results);
      expect(await activeAdmins()).toBe(1);
    }
  });
});
