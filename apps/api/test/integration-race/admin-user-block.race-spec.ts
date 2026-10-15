import { BadRequestException, ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import { SessionStateService } from '../../src/modules/auth/session-state.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { UserBlockService } from '../../src/modules/admin/user-block.service';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import type { Env } from '../../src/config/env.validation';
import { createUser, randCode, warmPool } from './helpers';

/**
 * ADMINOPS-1 / MONEY-13 / ADMINOPS-11 trên Postgres thật: hạ quyền và khoá tài khoản phải có hiệu lực
 * ngay với access token đã cấp, không đợi 15 phút; admin không tự cấp lại quyền cho mình được.
 */
describe('Khoá tài khoản + hạ quyền có hiệu lực ngay (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let rbac: RbacService;
  let sessions: SessionStateService;
  let strategy: JwtStrategy;
  let blocks: UserBlockService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const cfg: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'it-secret-user-block',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: 30,
      JWT_REFRESH_REUSE_GRACE_SECONDS: 30,
    };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    rbac = new RbacService(prisma);
    auth = new AuthService(prisma, new JwtService(), config, {} as ZaloService, rbac);
    sessions = new SessionStateService(prisma);
    strategy = new JwtStrategy(config, sessions);
    blocks = new UserBlockService(prisma, sessions);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  function rolesGuardAllows(user: JwtPayload, roles: string[]) {
    const reflector = new Reflector();
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, roles, handler);
    const ctx = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return new RolesGuard(reflector).canActivate(ctx);
  }

  it('admin bị thu hồi quyền: access token cũ không còn qua @Roles(ADMIN), không tự cấp lại được', async () => {
    const admin1 = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const admin2Phone = phone();
    const admin2 = await createUser(prisma, { role: 'ADMIN', phone: admin2Phone });
    const oldToken: JwtPayload = { sub: admin2.id, role: 'ADMIN', affiliateEnabled: true, dealerEnabled: false };

    await rbac.revokeGrant(admin1.id, admin2Phone);
    sessions.invalidate(admin2.id);

    const user = await strategy.validate(oldToken);
    expect(user.role).toBe('CUSTOMER');
    expect(() => rolesGuardAllows(user, ['ADMIN'])).toThrow(ForbiddenException);
    await expect(rbac.addGrant(admin2.id, admin2Phone, 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin2.id } })).role).toBe('CUSTOMER');
    expect(await prisma.roleGrant.count({ where: { phone: admin2Phone, revokedAt: null } })).toBe(0);
  });

  it('khoá: thu hồi mọi refresh token, access token cũ bị 401, đăng nhập lại cũng bị chặn', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    const deviceId = `dev_${randCode(10)}`;
    const login = await auth.loginAsGuest(deviceId);
    const userId = login.user.id;
    const token: JwtPayload = { sub: userId, role: 'CUSTOMER' };
    await strategy.validate(token);

    const out = await blocks.block(admin.id, userId, 'Farm voucher nhiều tài khoản');
    expect(out).toMatchObject({ id: userId, isBlocked: true, revokedSessions: 1 });

    await expect(strategy.validate(token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.loginAsGuest(deviceId)).rejects.toThrow('Tài khoản đã bị khoá.');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row).toMatchObject({ isBlocked: true, blockedById: admin.id, blockedReason: 'Farm voucher nhiều tài khoản' });
    expect(row.blockedAt).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);

    await blocks.unblock(admin.id, userId);
    await expect(strategy.validate(token)).resolves.toMatchObject({ sub: userId });
    await expect(auth.loginAsGuest(deviceId)).resolves.toMatchObject({ user: { id: userId } });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null,
    });
  });

  it('không tự khoá chính mình; không mở khoá tài khoản đã xoá theo yêu cầu', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    await expect(blocks.block(admin.id, admin.id, 'thử khoá chính mình')).rejects.toBeInstanceOf(BadRequestException);
    const deleted = await createUser(prisma, { isBlocked: true, metadata: { anonymizedAt: new Date().toISOString() } });
    await expect(blocks.unblock(admin.id, deleted.id)).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: deleted.id } })).isBlocked).toBe(true);
  });
});
