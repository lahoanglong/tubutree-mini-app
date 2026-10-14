import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { randCode, summarize, warmPool } from './helpers';

/**
 * MONEY-8 / BUYERWEB-3: nhiều tab web cùng refresh một cookie (khôi phục phiên trình duyệt, mở nhiều
 * sản phẩm ở tab mới) hoặc Mini App gửi lại refresh khi mất phản hồi. Trên Postgres thật vì cuộc đua nằm
 * ở updateMany có điều kiện (khoá dòng), fake Prisma không tái hiện được.
 */
describe('AuthService.refresh — ân hạn khi refresh đồng thời (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const cfg: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'it-secret-refresh-grace',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: 30,
      JWT_REFRESH_REUSE_GRACE_SECONDS: 30,
    };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, {} as ZaloService, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function guestSession() {
    const deviceId = `dev_${randCode(10)}`;
    const login = await auth.loginAsGuest(deviceId);
    return { login, userId: login.user.id };
  }

  it('3 refresh song song cùng một token → cả 3 thành công, mọi token mới đều refresh tiếp được', async () => {
    const { login, userId } = await guestSession();
    const results = await Promise.allSettled([1, 2, 3].map(() => auth.refresh(login.refreshToken)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(3);
    const next = s.fulfilled.map((r) => r.value.refreshToken);
    expect(new Set(next).size).toBe(3);
    for (const t of next) {
      await expect(auth.refresh(t)).resolves.toMatchObject({ user: { id: userId } });
    }
  });

  it('gửi lại token vừa xoay (mất phản hồi) → cấp cặp mới, token của lần xoay trước vẫn sống', async () => {
    const { login } = await guestSession();
    const first = await auth.refresh(login.refreshToken);
    const retry = await auth.refresh(login.refreshToken);
    expect(retry.refreshToken).not.toBe(first.refreshToken);
    await expect(auth.refresh(first.refreshToken)).resolves.toBeTruthy();
    await expect(auth.refresh(retry.refreshToken)).resolves.toBeTruthy();
  });

  it('dùng lại token đã xoay SAU ân hạn → thu hồi mọi phiên của user, kể cả token mới nhất', async () => {
    const { login, userId } = await guestSession();
    const next = await auth.refresh(login.refreshToken);
    const old = new Date(Date.now() - 60_000);
    await prisma.refreshToken.updateMany({ where: { userId, rotatedAt: { not: null } }, data: { rotatedAt: old, revokedAt: old } });

    await expect(auth.refresh(login.refreshToken)).rejects.toThrow('đã được sử dụng');
    await expect(auth.refresh(next.refreshToken)).rejects.toThrow('không hợp lệ');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.sessionsRevokedAt).not.toBeNull();
  });

  it('toàn bộ phiên bị thu hồi SAU lần xoay (khoá/ phát hiện reuse) → token vừa xoay không lấy lại được phiên', async () => {
    const { login, userId } = await guestSession();
    await auth.refresh(login.refreshToken);
    const now = new Date(Date.now() + 1);
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } });

    await expect(auth.refresh(login.refreshToken)).rejects.toThrow('không hợp lệ');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('token đã logout → không được ân hạn', async () => {
    const { login } = await guestSession();
    await auth.logout(login.refreshToken);
    await expect(auth.refresh(login.refreshToken)).rejects.toThrow('không hợp lệ');
  });
});
