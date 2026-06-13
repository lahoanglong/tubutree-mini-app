import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { ZaloService } from './zalo.service';

const configValues: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: 30,
};

function makeService(over: Record<string, unknown> = {}) {
  const create = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const base = {
    refreshToken: {
      findUnique: jest.fn(),
      updateMany,
      create,
    },
  };
  const prisma = { ...base, ...over } as unknown as PrismaService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
  const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
  const zalo = {} as unknown as ZaloService;
  return { svc: new AuthService(prisma, jwt, config, zalo), prisma, create, updateMany };
}

const USER = { id: 'u1', role: 'CUSTOMER', zaloId: 'z1', referralCode: 'R1' };

describe('AuthService.refresh (rotation atomic)', () => {
  it('token không tồn tại → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token đã revoke → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token hết hạn → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: null, expiresAt: new Date(Date.now() - 1000), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('hợp lệ → revoke-gate count=1 → cấp cặp token mới (JWT + refresh mới)', async () => {
    const { svc, prisma, create } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    const r = await svc.refresh('tok');
    expect(r.accessToken).toBe('access-jwt');
    expect(r.refreshToken).toBeTruthy();
    expect(r.refreshToken).not.toBe('tok'); // token mới khác token cũ
    expect(create).toHaveBeenCalledTimes(1); // lưu refresh mới (đã hash)
  });

  it('reuse/double-submit: revoke-gate count=0 → Unauthorized "đã được sử dụng", không cấp token', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    (updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // request khác đã revoke trước
    await expect(svc.refresh('tok')).rejects.toThrow('đã được sử dụng');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('revoke refresh token theo hash (chưa revoke)', async () => {
    const { svc, updateMany } = makeService();
    await svc.logout('tok');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
    );
  });
});
