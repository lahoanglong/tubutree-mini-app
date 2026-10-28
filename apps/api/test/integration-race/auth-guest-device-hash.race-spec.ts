import { createHash } from 'node:crypto';
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

const hashed = (deviceId: string) => `guest_h_${createHash('sha256').update(deviceId).digest('hex')}`;

/**
 * Khoá khách là băm của deviceId. Cuộc đua nằm ở hai chỗ chỉ Postgres thật mới tái hiện được: unique(zaloId) khi nhiều
 * request tạo khách mới cùng lúc, và updateMany có điều kiện khi nhiều request cùng đổi dòng cũ guest_<deviceId> sang khoá băm.
 */
describe('AuthService.loginAsGuest — khoá băm của deviceId (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const cfg: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'it-secret-guest-hash',
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

  it('5 request song song cùng deviceId mới → đúng một dòng khách mang khoá băm, cùng user id', async () => {
    const deviceId = `d_${randCode(20)}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => auth.loginAsGuest(deviceId)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.user.id)).size).toBe(1);
    expect(await prisma.user.count({ where: { zaloId: { contains: deviceId } } })).toBe(0);
    expect(await prisma.user.count({ where: { zaloId: hashed(deviceId) } })).toBe(1);
  });

  it('dòng khách cũ guest_<deviceId> + 5 request song song → vẫn một dòng, giữ id và số dư, khoá đổi sang băm', async () => {
    const deviceId = `d_${randCode(20)}`;
    const old = await prisma.user.create({
      data: { zaloId: `guest_${deviceId}`, fullName: 'Khách', referralCode: randCode(8), pointsBalance: 120 },
    });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => auth.loginAsGuest(deviceId)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.user.id))).toEqual(new Set([old.id]));
    const row = await prisma.user.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.zaloId).toBe(hashed(deviceId));
    expect(row.pointsBalance).toBe(120);
    expect(await prisma.user.count({ where: { zaloId: { contains: deviceId } } })).toBe(0);
    await expect(auth.loginAsGuest(deviceId)).resolves.toMatchObject({ user: { id: old.id } });
  });

  it('deviceId dựng sao cho khoá thô trùng khoá băm của người khác → nhận dòng mới, không cướp dòng', async () => {
    const victimDevice = `d_${randCode(20)}`;
    const victim = await auth.loginAsGuest(victimDevice);
    const attackerDevice = `h_${createHash('sha256').update(victimDevice).digest('hex')}`;
    const attacker = await auth.loginAsGuest(attackerDevice);
    expect(attacker.user.id).not.toBe(victim.user.id);
    const victimRow = await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } });
    expect(victimRow.zaloId).toBe(hashed(victimDevice));
  });
});
