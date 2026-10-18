import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { UserBlockService } from '../../src/modules/admin/user-block.service';
import { SessionStateService } from '../../src/modules/auth/session-state.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.validation';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { PayoutAdminController } from '../../src/modules/affiliate/payout-admin.controller';
import { FaqAdminController } from '../../src/modules/faq/faq-admin.controller';
import { AdminController } from '../../src/modules/admin/admin.controller';
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
    const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma));
    rbac = new RbacService(prisma, fulfilment);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, rbac, none, none, fulfilment);
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

  it('nhóm MARKETING/KE_TOAN (D1-05): lưu theo thứ tự chuẩn, JwtStrategy đọc lại, RolesGuard thật mở đúng route; gỡ nhóm là mất quyền ngay', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const staff = await createUser(prisma, { role: 'STAFF', phone: phone() });
    const guard = new RolesGuard(new Reflector());
    const can = (controller: object, handler: object, user: object) => {
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => handler, getClass: () => controller } as unknown as ExecutionContext;
      try {
        return guard.canActivate(ctx);
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    const routes = (user: object) => ({
      payoutPaid: can(PayoutAdminController, PayoutAdminController.prototype.markPaid, user),
      payoutApprove: can(PayoutAdminController, PayoutAdminController.prototype.approve, user),
      faqCreate: can(FaqAdminController, FaqAdminController.prototype.create, user),
      setConfig: can(AdminController, AdminController.prototype.setConfig, user),
      setRole: can(AdminController, AdminController.prototype.setUserRole, user),
    });

    await admin.setStaffPermissions(boss.id, staff.id, ['KE_TOAN', 'MARKETING']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).staffPermissions).toEqual(['MARKETING', 'KE_TOAN']);
    // Cùng tập nhóm, khác thứ tự: không đổi gì, không ghi sổ.
    await expect(admin.setStaffPermissions(boss.id, staff.id, ['MARKETING', 'KE_TOAN'])).resolves.toMatchObject({ changed: false });
    sessions.invalidate(staff.id);
    const both = await strategy.validate({ sub: staff.id, role: 'STAFF' });
    expect(routes(both)).toEqual({ payoutPaid: true, payoutApprove: false, faqCreate: true, setConfig: false, setRole: false });

    await admin.setStaffPermissions(boss.id, staff.id, ['KE_TOAN']);
    sessions.invalidate(staff.id);
    const keToan = await strategy.validate({ sub: staff.id, role: 'STAFF' });
    expect(routes(keToan)).toEqual({ payoutPaid: true, payoutApprove: false, faqCreate: false, setConfig: false, setRole: false });

    const ev = await prisma.userAdminEvent.findMany({ where: { userId: staff.id, kind: 'STAFF_PERMISSIONS' }, orderBy: { createdAt: 'asc' } });
    expect(ev.map((e) => [e.fromValue, e.toValue])).toEqual([
      ['', 'KE_TOAN,MARKETING'],
      ['KE_TOAN,MARKETING', 'KE_TOAN'],
    ]);
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

  it('dòng bật/tắt cờ gian hàng đối tác (STOREFRONT_PARTNER) không chiếm chỗ của lịch sử vai trò/khoá trong 100 dòng gần nhất', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const p = phone();
    const u = await createUser(prisma, { role: 'STAFF', phone: p });
    await admin.setUserRole(boss.id, p, 'CUSTOMER');
    await blocks.block(boss.id, u.id, 'IT');
    await prisma.userAdminEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId: u.id, kind: 'STOREFRONT_PARTNER', fromValue: String(i % 2 === 0), toValue: String(i % 2 !== 0), reason: 'sf-it', actorId: boss.id,
      })),
    });
    const d = await admin.getUserDetail(u.id);
    expect(d.roleHistory.map((e) => `${e.kind}:${e.fromValue}->${e.toValue}`)).toEqual(['ROLE:STAFF->CUSTOMER']);
    expect(d.blockHistory.map((e) => e.kind)).toEqual(['BLOCK']);
  });

  it('trả lịch sử bật/tắt cờ gian hàng đối tác (STOREFRONT_PARTNER) kèm người làm, mới nhất trước, tách khỏi vai trò/khoá', async () => {
    const boss = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const u = await createUser(prisma, { role: 'STAFF', phone: phone() });
    await prisma.userAdminEvent.create({
      data: { userId: u.id, kind: 'STOREFRONT_PARTNER', fromValue: 'false', toValue: 'true', reason: 'sf-1', actorId: boss.id, createdAt: new Date('2026-10-01T00:00:00Z') },
    });
    await prisma.userAdminEvent.create({
      data: { userId: u.id, kind: 'STOREFRONT_PARTNER', fromValue: 'true', toValue: 'false', reason: 'sf-1', actorId: boss.id, createdAt: new Date('2026-10-02T00:00:00Z') },
    });
    const d = await admin.getUserDetail(u.id);
    expect(d.partnerHistory.map((e) => `${e.kind}:${e.fromValue}->${e.toValue}`)).toEqual([
      'STOREFRONT_PARTNER:true->false',
      'STOREFRONT_PARTNER:false->true',
    ]);
    expect(d.partnerHistory[0]).toMatchObject({ reason: 'sf-1', actorId: boss.id, actorName: expect.any(String) });
    expect(d.roleHistory).toEqual([]);
    expect(d.blockHistory).toEqual([]);
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
