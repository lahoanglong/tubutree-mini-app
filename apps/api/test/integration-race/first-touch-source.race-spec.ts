import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { createUser, randCode, warmPool } from './helpers';

/**
 * Nguồn chạm đầu (users.firstTouch*) trên Postgres thật: ghi lúc tạo tài khoản và lúc gộp khách vào tài khoản còn trống,
 * không bao giờ ghi đè. Câu SELECT ... FOR UPDATE của mergeGuestInto đọc thêm ba cột mới nên cần chạy trên DB thật.
 */
describe('users.firstTouch* (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let zaloIdForNextCall = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-ft', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const touchedAt = new Date(Date.now() - 3 * 86_400_000);

  it('khách mới: ghi nguồn, chiến dịch và giờ chạm; đăng nhập lại với nguồn khác không đổi gì', async () => {
    const deviceId = `d_${randCode(20)}`;
    const first = await auth.loginAsGuest(deviceId, undefined, {
      source: 'Shopee',
      campaign: 'card-2610',
      at: touchedAt.toISOString(),
    });
    let row = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(row.firstTouchSource).toBe('shopee');
    expect(row.firstTouchCampaign).toBe('card-2610');
    expect(row.firstTouchAt?.toISOString()).toBe(touchedAt.toISOString());

    await auth.loginAsGuest(deviceId, undefined, { source: 'tiktok', campaign: 'khac' });
    row = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(row.firstTouchSource).toBe('shopee');
    expect(row.firstTouchCampaign).toBe('card-2610');
  });

  it('giá trị bẩn: đăng nhập vẫn tạo được tài khoản, cột nguồn để trống', async () => {
    const res = await auth.loginAsGuest(`d_${randCode(20)}`, undefined, { source: "x'; DROP TABLE users;--" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.user.id } });
    expect([row.firstTouchSource, row.firstTouchCampaign, row.firstTouchAt]).toEqual([null, null, null]);
  });

  async function guestAndTarget(guestTouch: string | null, targetTouch: string | null) {
    const guest = await createUser(prisma, {
      zaloId: `guest_dev_${randCode(8)}`,
      fullName: 'Khách',
      ...(guestTouch ? { firstTouchSource: guestTouch, firstTouchCampaign: 'c-guest', firstTouchAt: touchedAt } : {}),
    });
    const target = await createUser(prisma, {
      zaloId: `zalo_${randCode(10)}`,
      ...(targetTouch ? { firstTouchSource: targetTouch, firstTouchCampaign: 'c-target', firstTouchAt: touchedAt } : {}),
    });
    await prisma.refreshToken.create({
      data: { userId: guest.id, tokenHash: `it-${randCode(16)}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    return { guest, target };
  }

  it('gộp khách vào tài khoản còn trống: tài khoản đích nhận nguồn của khách, dòng khách giữ nguyên', async () => {
    const { guest, target } = await guestAndTarget('lazada', null);
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const g = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect([t.firstTouchSource, t.firstTouchCampaign, t.firstTouchAt?.toISOString()]).toEqual([
      'lazada',
      'c-guest',
      touchedAt.toISOString(),
    ]);
    expect(g.firstTouchSource).toBe('lazada');
  });

  it('gộp khách vào tài khoản đã có nguồn: giữ nguồn của đích', async () => {
    const { guest, target } = await guestAndTarget('lazada', 'oa');
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect([t.firstTouchSource, t.firstTouchCampaign]).toEqual(['oa', 'c-target']);
  });

  it('gộp khi cả hai đều trống: đích vẫn trống', async () => {
    const { guest, target } = await guestAndTarget(null, null);
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect([t.firstTouchSource, t.firstTouchCampaign, t.firstTouchAt]).toEqual([null, null, null]);
  });
});
