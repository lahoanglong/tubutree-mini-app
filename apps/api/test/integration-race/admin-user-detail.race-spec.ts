import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { UserBlockService } from '../../src/modules/admin/user-block.service';
import { SessionStateService } from '../../src/modules/auth/session-state.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser } from './helpers';

/**
 * ADMINOPS-10/11 trên Postgres THẬT: nhóm việc của nhân viên (CSKH/KHO) lưu ở users.staffPermissions, có hiệu lực
 * ngay qua JwtStrategy; mọi lần đổi vai trò / nhóm việc / khoá / mở khoá vào sổ user_admin_events; màn chi tiết
 * người dùng trả đơn, sổ ví, Điểm Xanh, lịch sử vai trò và lịch sử khoá.
 */
describe('Chi tiết người dùng + nhóm việc nhân viên (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let blocks: UserBlockService;
  let rbac: RbacService;
  let sessions: SessionStateService;
  let strategy: JwtStrategy;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    rbac = new RbacService(prisma);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, rbac, none, none);
    sessions = new SessionStateService(prisma);
    blocks = new UserBlockService(prisma, sessions);
    const config = { get: () => 'it-secret' } as unknown as ConfigService<Env, true>;
    strategy = new JwtStrategy(config, sessions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  it('gán nhóm việc chỉ cho STAFF; có hiệu lực ngay ở request kế tiếp; ghi sổ', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const cust = await createUser(prisma, { phone: phone() });
    await expect(admin.setStaffPermissions(boss.id, cust.id, ['CSKH'])).rejects.toBeInstanceOf(BadRequestException);

    const staff = await createUser(prisma, { role: 'STAFF', phone: phone() });
    await expect(admin.setStaffPermissions(boss.id, staff.id, ['CSKH', 'BOGUS'])).rejects.toBeInstanceOf(BadRequestException);
    await admin.setStaffPermissions(boss.id, staff.id, ['KHO', 'CSKH', 'KHO']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).staffPermissions.sort()).toEqual(['CSKH', 'KHO']);
    sessions.invalidate(staff.id);
    await expect(strategy.validate({ sub: staff.id, role: 'STAFF' })).resolves.toMatchObject({
      staffPermissions: expect.arrayContaining(['CSKH', 'KHO']),
    });

    const ev = await prisma.userAdminEvent.findMany({ where: { userId: staff.id, kind: 'STAFF_PERMISSIONS' } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: '', toValue: 'CSKH,KHO', actorId: boss.id });
  });

  it('hạ STAFF về khách thì xoá nhóm việc; đổi vai trò, khoá, mở khoá đều vào sổ; chi tiết trả đủ các phần', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const p = phone();
    const u = await createUser(prisma, { role: 'STAFF', phone: p, staffPermissions: ['CSKH'], walletBalance: 50_000 });
    await admin.setUserRole(boss.id, p, 'CUSTOMER');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).staffPermissions).toEqual([]);

    await blocks.block(boss.id, u.id, 'bom hàng COD');
    await blocks.unblock(boss.id, u.id);

    const order = await createOrder(prisma, { userId: u.id, total: 123_000 });
    await prisma.walletTransaction.create({
      data: { userId: u.id, delta: 50_000, balanceAfter: 50_000, type: 'ADJUST', reason: 'IT' },
    });
    await prisma.pointsTransaction.create({ data: { userId: u.id, delta: 10, reason: 'IT' } });

    const d = await admin.getUserDetail(u.id);
    expect(d.user).toMatchObject({ id: u.id, role: 'CUSTOMER', walletBalance: 50_000 });
    expect(d.orders.items.map((o) => o.code)).toContain(order.code);
    expect(d.orders.total).toBe(1);
    expect(d.wallet.map((w) => w.delta)).toEqual([50_000]);
    expect(d.points.map((x) => x.delta)).toEqual([10]);
    expect(d.roleHistory.map((e) => `${e.kind}:${e.fromValue}->${e.toValue}`)).toEqual(
      expect.arrayContaining(['ROLE:STAFF->CUSTOMER', 'STAFF_PERMISSIONS:CSKH->']),
    );
    expect(d.blockHistory.map((e) => e.kind)).toEqual(['UNBLOCK', 'BLOCK']);
    expect(d.blockHistory[1]).toMatchObject({ reason: 'bom hàng COD', actorId: boss.id });
  });

  it('cấp quyền theo SĐT (RoleGrant) áp lên tài khoản → sổ ghi ai cấp', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const p = phone();
    const u = await createUser(prisma, { phone: p });
    await rbac.addGrant(boss.id, p, 'STAFF');
    const ev = await prisma.userAdminEvent.findMany({ where: { userId: u.id, kind: 'ROLE' } });
    expect(ev).toEqual([expect.objectContaining({ fromValue: 'CUSTOMER', toValue: 'STAFF', actorId: boss.id })]);
    const d = await admin.getUserDetail(u.id);
    expect(d.grants).toEqual([expect.objectContaining({ role: 'STAFF', grantedBy: boss.id, revokedAt: null })]);
  });
});
