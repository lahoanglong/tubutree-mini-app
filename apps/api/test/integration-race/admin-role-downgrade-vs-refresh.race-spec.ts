import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser, sleep, warmPool } from './helpers';

describe('Hạ ADMIN→CUSTOMER chạy song song với các lần refresh token của chính người đó (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rbac: RbacService;
  let admin: AdminService;
  let boss: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    rbac = new RbacService(prisma, fulfilment);
    const none = {} as never;
    const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined) } as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, rbac, none, none, fulfilment);
    boss = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const newPhone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  it('20 lần refresh đua với setUserRole(ADMIN→CUSTOMER): cuối cùng role CUSTOMER và không còn grant ADMIN còn hiệu lực', async () => {
    for (let round = 0; round < 8; round++) {
      const phone = newPhone();
      const target = await createUser(prisma, { role: 'ADMIN', phone });
      await prisma.roleGrant.create({ data: { phone, role: 'ADMIN', grantedBy: boss.id } });
      // Giống issueTokens: đọc user mới rồi applyGrants; xen kẽ độ trễ để một số lần rơi vào giữa lúc commit và thu hồi grant.
      const refresh = async (i: number) => {
        await sleep(i * 2);
        const user = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
        await rbac.applyGrants(user);
      };
      const refreshes = Array.from({ length: 20 }, (_, i) => refresh(i));
      const [downgrade] = await Promise.allSettled([admin.setUserRole(boss.id, phone, 'CUSTOMER'), ...refreshes]);
      expect(downgrade.status).toBe('fulfilled');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true } });
      const active = await prisma.roleGrant.count({ where: { phone, revokedAt: null, role: 'ADMIN' } });
      expect({ role: after.role, activeAdminGrants: active }).toEqual({ role: 'CUSTOMER', activeAdminGrants: 0 });
    }
  });

  // m1: thứ tự khoá thống nhất lockAdminRoster, role_grants, users. Thứ tự cũ (applyGrants: users rồi grants) đảo với setUserRole/revokeGrant.
  it('20 vòng applyGrants song song setUserRole: không vòng nào bị deadlock (40P01) hay lỗi khoá', async () => {
    for (let round = 0; round < 20; round++) {
      const phone = newPhone();
      const target = await createUser(prisma, { role: 'CUSTOMER', phone });
      await prisma.roleGrant.create({ data: { phone, role: 'STAFF', grantedBy: boss.id } });
      const refresh = async (i: number) => {
        await sleep(i);
        await rbac.applyGrants(await prisma.user.findUniqueOrThrow({ where: { id: target.id } }));
      };
      const res = await Promise.allSettled([admin.setUserRole(boss.id, phone, 'AFFILIATE'), refresh(0), refresh(1), refresh(2)]);
      const errs = res.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      expect(errs).toEqual([]);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true } });
      const active = await prisma.roleGrant.count({ where: { phone, revokedAt: null, role: 'STAFF' } });
      // Hoặc role hạ về AFFILIATE và grant bị thu hồi, hoặc refresh thắng trước (STAFF) rồi setUserRole hạ: cuối cùng luôn AFFILIATE.
      expect({ role: after.role, active }).toEqual({ role: 'AFFILIATE', active: 0 });
    }
  });

  it('20 vòng applyGrants song song revokeGrant: không deadlock, không có user STAFF mà không còn grant hiệu lực', async () => {
    for (let round = 0; round < 20; round++) {
      const phone = newPhone();
      const target = await createUser(prisma, { role: 'CUSTOMER', phone });
      await prisma.roleGrant.create({ data: { phone, role: 'STAFF', grantedBy: boss.id } });
      const refresh = async (i: number) => {
        await sleep(i);
        await rbac.applyGrants(await prisma.user.findUniqueOrThrow({ where: { id: target.id } }));
      };
      const res = await Promise.allSettled([rbac.revokeGrant(boss.id, phone, 'het han hop dong'), refresh(0), refresh(1), refresh(2)]);
      const errs = res.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      expect(errs).toEqual([]);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true } });
      const active = await prisma.roleGrant.count({ where: { phone, revokedAt: null } });
      expect(after.role === 'STAFF' && active === 0).toBe(false);
      expect(after.role).toBe('CUSTOMER');
    }
  });

  it('refresh sau khi bị hạ không nâng lại: ba lần refresh liên tiếp vẫn CUSTOMER', async () => {
    const phone = newPhone();
    const target = await createUser(prisma, { role: 'ADMIN', phone });
    await prisma.roleGrant.create({ data: { phone, role: 'ADMIN', grantedBy: boss.id } });
    await admin.setUserRole(boss.id, phone, 'CUSTOMER');
    for (let i = 0; i < 3; i++) await rbac.applyGrants(await prisma.user.findUniqueOrThrow({ where: { id: target.id } }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('CUSTOMER');
  });
});
