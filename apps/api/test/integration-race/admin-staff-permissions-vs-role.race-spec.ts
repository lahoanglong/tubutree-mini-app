import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser } from './helpers';

/**
 * Gán nhóm việc chen với đổi vai trò, trên Postgres thật: tài khoản không còn STAFF không được mang nhóm việc,
 * và cấp lại STAFF thì bắt đầu từ nhóm rỗng.
 */
describe('Nhóm việc nhân viên vs đổi vai trò (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma));
    const rbac = new RbacService(prisma, fulfilment);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, rbac, none, none, fulfilment);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function user(data: Parameters<typeof createUser>[1]) {
    const u = await createUser(prisma, { phone: phone(), ...data });
    userIds.push(u.id);
    return u;
  }
  const perms = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).staffPermissions;

  it('RC-06: bản đọc cũ thấy STAFF nhưng tài khoản đã bị hạ → 400, không ghi nhóm lên CUSTOMER', async () => {
    const boss = await user({ role: 'ADMIN' });
    const target = await user({ role: 'CUSTOMER' });
    const real = prisma.user.findUnique.bind(prisma.user);
    const spy = jest.spyOn(prisma.user, 'findUnique').mockImplementationOnce(((args: never) =>
      real(args).then((u) => (u ? { ...u, role: 'STAFF' } : u))) as never);
    await expect(admin.setStaffPermissions(boss.id, target.id, ['KE_TOAN'])).rejects.toBeInstanceOf(BadRequestException);
    spy.mockRestore();
    expect(await perms(target.id)).toEqual([]);
    expect(await prisma.userAdminEvent.count({ where: { userId: target.id, kind: 'STAFF_PERMISSIONS' } })).toBe(0);
  });

  it('RC-06: setStaffPermissions ‖ hạ về CUSTOMER song song nhiều vòng → cuối cùng không còn STAFF thì nhóm rỗng', async () => {
    const boss = await user({ role: 'ADMIN' });
    for (let i = 0; i < 8; i++) {
      const target = await user({ role: 'STAFF', staffPermissions: ['KHO'] });
      await Promise.allSettled([
        admin.setStaffPermissions(boss.id, target.id, ['KE_TOAN']),
        admin.setUserRole(boss.id, target.phone!, 'CUSTOMER'),
      ]);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.role).toBe('CUSTOMER');
      expect(after.staffPermissions).toEqual([]);
    }
  });

  it('RC-06: nâng lên STAFF từ vai trò khác thì nhóm cũ (nếu có) bị bỏ, ghi sổ', async () => {
    const boss = await user({ role: 'ADMIN' });
    const target = await user({ role: 'CUSTOMER', staffPermissions: ['KE_TOAN'] });
    await admin.setUserRole(boss.id, target.phone!, 'STAFF');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.role).toBe('STAFF');
    expect(after.staffPermissions).toEqual([]);
    const ev = await prisma.userAdminEvent.findFirstOrThrow({ where: { userId: target.id, kind: 'STAFF_PERMISSIONS' } });
    expect([ev.fromValue, ev.toValue]).toEqual(['KE_TOAN', '']);
  });

  it('đặt lại STAFF cho người đã là STAFF thì giữ nhóm đang có', async () => {
    const boss = await user({ role: 'ADMIN' });
    const target = await user({ role: 'STAFF', staffPermissions: ['KHO'] });
    await admin.setUserRole(boss.id, target.phone!, 'STAFF');
    expect(await perms(target.id)).toEqual(['KHO']);
  });

  it('gán nhóm cho STAFF bình thường: ghi nhóm + sổ cùng lúc', async () => {
    const boss = await user({ role: 'ADMIN' });
    const target = await user({ role: 'STAFF' });
    const res = await admin.setStaffPermissions(boss.id, target.id, ['CSKH']);
    expect(res.changed).toBe(true);
    expect(await perms(target.id)).toEqual(['CSKH']);
    expect(await prisma.userAdminEvent.count({ where: { userId: target.id, kind: 'STAFF_PERMISSIONS' } })).toBe(1);
  });
});
