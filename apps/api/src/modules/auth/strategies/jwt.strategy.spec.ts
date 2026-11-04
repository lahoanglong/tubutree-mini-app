import type { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@tubutree/shared-types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { SessionStateService } from '../session-state.service';

function setup(row: { role: string; isBlocked: boolean; staffPermissions?: string[]; sessionsRevokedAt?: Date | null; mergedIntoId?: string | null } | null) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const config = { get: () => 'access-secret-for-tests' } as unknown as ConfigService<never, true>;
  const sessions = new SessionStateService(prisma);
  return { strategy: new JwtStrategy(config, sessions), findUnique, sessions };
}

const ADMIN_TOKEN: JwtPayload = { sub: 'u_admin2', role: 'ADMIN', affiliateEnabled: true, dealerEnabled: false };

describe('JwtStrategy.validate — quyền đọc từ DB, không tin role trong token cũ (ADMINOPS-1)', () => {
  it('admin đã bị hạ về CUSTOMER dùng access token cũ → request.user mang role CUSTOMER', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false });
    const user = await strategy.validate(ADMIN_TOKEN);
    expect(user).toMatchObject({ sub: 'u_admin2', role: 'CUSTOMER', affiliateEnabled: false, dealerEnabled: false });
  });

  it('được nâng lên DEALER giữa chừng → cờ dealerEnabled đi theo role trong DB', async () => {
    const { strategy } = setup({ role: 'DEALER', isBlocked: false });
    const user = await strategy.validate({ sub: 'u1', role: 'CUSTOMER', affiliateEnabled: false, dealerEnabled: false });
    expect(user).toMatchObject({ role: 'DEALER', dealerEnabled: true, affiliateEnabled: false });
  });

  it('tài khoản bị khoá → 401 ngay, không đợi access token hết hạn', async () => {
    const { strategy } = setup({ role: 'ADMIN', isBlocked: true });
    await expect(strategy.validate(ADMIN_TOKEN)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_BLOCKED', message: expect.stringContaining('liên hệ CSKH Tubu Tree') },
    });
  });

  it('user không còn tồn tại → 401', async () => {
    const { strategy } = setup(null);
    await expect(strategy.validate(ADMIN_TOKEN)).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  });

  it('cache ngắn: hai request liền nhau chỉ đọc DB một lần; invalidate buộc đọc lại', async () => {
    const { strategy, findUnique, sessions } = setup({ role: 'ADMIN', isBlocked: false });
    await strategy.validate(ADMIN_TOKEN);
    await strategy.validate(ADMIN_TOKEN);
    expect(findUnique).toHaveBeenCalledTimes(1);
    sessions.invalidate('u_admin2');
    await strategy.validate(ADMIN_TOKEN);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('cache hết hạn sau TTL → đọc lại DB', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-14T03:00:00Z') });
    try {
      const { strategy, findUnique } = setup({ role: 'ADMIN', isBlocked: false });
      await strategy.validate(ADMIN_TOKEN);
      jest.setSystemTime(Date.now() + SessionStateService.TTL_MS + 1);
      findUnique.mockResolvedValue({ role: 'CUSTOMER', isBlocked: false });
      await expect(strategy.validate(ADMIN_TOKEN)).resolves.toMatchObject({ role: 'CUSTOMER' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('ADMINOPS-10: nhóm việc STAFF lấy từ DB gắn vào request.user; bị gỡ nhóm thì mất ngay sau cache', async () => {
    const { strategy, findUnique, sessions } = setup({ role: 'STAFF', isBlocked: false, staffPermissions: ['CSKH'] });
    const token: JwtPayload = { sub: 'u_staff', role: 'STAFF' };
    await expect(strategy.validate(token)).resolves.toMatchObject({ role: 'STAFF', staffPermissions: ['CSKH'] });
    findUnique.mockResolvedValue({ role: 'STAFF', isBlocked: false, staffPermissions: [] });
    sessions.invalidate('u_staff');
    await expect(strategy.validate(token)).resolves.toMatchObject({ staffPermissions: [] });
  });

  it('token mang sẵn staffPermissions không được tin — luôn ghi đè bằng DB', async () => {
    const { strategy } = setup({ role: 'STAFF', isBlocked: false, staffPermissions: [] });
    const forged = { sub: 'u_staff', role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] } as JwtPayload;
    await expect(strategy.validate(forged)).resolves.toMatchObject({ staffPermissions: [] });
  });
});

describe('JwtStrategy.validate — access token chết theo phiên (L1-03)', () => {
  const revokedAt = new Date('2026-11-05T03:00:00.700Z');
  const iatSec = (d: Date, deltaSec: number) => Math.floor(d.getTime() / 1000) + deltaSec;

  it('token cấp trước lần thu hồi → 401 SESSION_EXPIRED', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, sessionsRevokedAt: revokedAt });
    await expect(strategy.validate({ ...ADMIN_TOKEN, iat: iatSec(revokedAt, -60) })).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
  });

  it('token cấp cùng giây với lần thu hồi vẫn bị chặn (so ở mức giây)', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, sessionsRevokedAt: revokedAt });
    await expect(strategy.validate({ ...ADMIN_TOKEN, iat: iatSec(revokedAt, 0) })).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
  });

  it('token cấp sau lần thu hồi → qua', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, sessionsRevokedAt: revokedAt });
    await expect(strategy.validate({ ...ADMIN_TOKEN, role: 'CUSTOMER', iat: iatSec(revokedAt, 1) })).resolves.toMatchObject({ sub: 'u_admin2' });
  });

  it('chưa từng thu hồi (null) → qua dù token có iat', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, sessionsRevokedAt: null });
    await expect(strategy.validate({ ...ADMIN_TOKEN, iat: 1 })).resolves.toBeDefined();
  });

  it('khách đã gộp vào tài khoản khác → 401 dù token mới', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, mergedIntoId: 'u_target' });
    await expect(strategy.validate({ ...ADMIN_TOKEN, iat: iatSec(revokedAt, 100) })).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
  });

  it('token không có iat mà user đã từng thu hồi → 401 (không tin token thiếu mốc)', async () => {
    const { strategy } = setup({ role: 'CUSTOMER', isBlocked: false, sessionsRevokedAt: revokedAt });
    await expect(strategy.validate(ADMIN_TOKEN)).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  });
});
