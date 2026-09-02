import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { ZaloService } from './zalo.service';
import type { RbacService } from '../staff/rbac/rbac.service';

// applyGrants no-op (identity) cho unit test auth — không đụng DB.
const mkRbac = () =>
  ({ applyGrants: jest.fn(async (u: unknown) => u) } as unknown as RbacService);

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
  return { svc: new AuthService(prisma, jwt, config, zalo, mkRbac()), prisma, create, updateMany };
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

describe('AuthService.loginWithZaloMiniApp (phone)', () => {
  function makeLoginSvc(userMocks: Record<string, jest.Mock>, zaloMocks: Record<string, jest.Mock>) {
    const prisma = {
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      user: userMocks,
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = zaloMocks as unknown as ZaloService;
    return new AuthService(prisma, jwt, config, zalo, mkRbac());
  }

  it('user mới + có phoneToken → tạo user kèm SĐT đã chuẩn hoá', async () => {
    const create = jest.fn().mockResolvedValue({ ...USER, phone: '0901234567' });
    const svc = makeLoginSvc(
      { findUnique: jest.fn().mockResolvedValue(null), create },
      {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567'),
      },
    );
    const r = await svc.loginWithZaloMiniApp('code', 'at', 'ptoken');
    expect(r.accessToken).toBe('access-jwt');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '0901234567', zaloId: 'z1' }) }),
    );
  });

  it('merge: user web có phone chưa có zaloId → gắn zaloId thay vì tạo mới', async () => {
    const update = jest.fn().mockResolvedValue({ ...USER, phone: '0901234567' });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null) // by zaloId
      .mockResolvedValueOnce({ id: 'web1', phone: '0901234567', zaloId: null, fullName: 'Web' }); // by phone
    const svc = makeLoginSvc(
      { findUnique, update, create: jest.fn() },
      {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567'),
      },
    );
    await svc.loginWithZaloMiniApp('code', 'at', 'ptoken');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'web1' }, data: expect.objectContaining({ zaloId: 'z1' }) }),
    );
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

describe('AuthService — ghi nhận người giới thiệu lúc đăng ký (referredById)', () => {
  function guestSvc(referrer: { id: string } | null, existingGuest = false) {
    const create = jest
      .fn()
      .mockImplementation(({ data }) => ({ id: 'newuser', role: 'CUSTOMER', ...data }));
    const findUnique = jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.zaloId) return existingGuest ? { ...USER, zaloId: where.zaloId } : null;
      if (where.referralCode === 'REF1') return referrer; // resolveReferrerId (đã chuẩn hoá hoa)
      return null; // generateReferralCode: code sinh ra chưa bị chiếm
    });
    const prisma = {
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique, create },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    return {
      svc: new AuthService(prisma, jwt, config, {} as unknown as ZaloService, mkRbac()),
      create,
      findUnique,
    };
  }

  it('guest mới + referralCode hợp lệ (chuẩn hoá hoa) → set referredById = người giới thiệu', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' });
    await svc.loginAsGuest('dev1', 'ref1'); // lowercase → chuẩn hoá REF1
    expect(create.mock.calls[0][0].data.referredById).toBe('referrer1');
  });

  it('guest mới + referralCode không tồn tại → referredById null', async () => {
    const { svc, create } = guestSvc(null);
    await svc.loginAsGuest('dev1', 'REF1');
    expect(create.mock.calls[0][0].data.referredById).toBeNull();
  });

  it('guest mới KHÔNG có referralCode → referredById null', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' });
    await svc.loginAsGuest('dev1');
    expect(create.mock.calls[0][0].data.referredById).toBeNull();
  });

  it('guest ĐÃ tồn tại + referralCode → KHÔNG tạo lại, KHÔNG ghi đè referredById', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' }, true);
    await svc.loginAsGuest('dev1', 'REF1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AuthService — chặn user bị khoá (isBlocked) lấy token', () => {
  it('refresh(): user.isBlocked=true → Unauthorized, KHÔNG cấp refresh token mới (dù token cũ đã bị revoke)', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1e6),
      user: { ...USER, isBlocked: true },
    });
    await expect(svc.refresh('tok')).rejects.toThrow('bị khoá');
    expect(updateMany).toHaveBeenCalledTimes(1); // token cũ vẫn bị revoke (đúng ý — không để tái sử dụng)
    expect(create).not.toHaveBeenCalled(); // nhưng KHÔNG cấp refresh token mới
  });

  it('login guest ĐÃ tồn tại + isBlocked=true → Unauthorized, KHÔNG né chặn refresh bằng cách đăng nhập lại', async () => {
    const findUnique = jest.fn().mockResolvedValue({ ...USER, isBlocked: true });
    const create = jest.fn();
    const prisma = {
      refreshToken: { create: jest.fn() },
      user: { findUnique, create },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const svc = new AuthService(prisma, jwt, config, {} as unknown as ZaloService, mkRbac());
    await expect(svc.loginAsGuest('dev1')).rejects.toThrow('bị khoá');
    expect(create).not.toHaveBeenCalled();
    expect((prisma.refreshToken.create as jest.Mock)).not.toHaveBeenCalled();
  });

  it('loginWithZaloMiniApp: user Zalo đã tồn tại + isBlocked=true → Unauthorized, không cấp token', async () => {
    // fullName khớp info.name để không rẽ vào nhánh update() đồng bộ tên/avatar — test tập
    // trung vào việc issueTokens() chặn user bị khoá ngay ở luồng login, không phải luồng sync.
    const findUnique = jest.fn().mockResolvedValue({ ...USER, isBlocked: true, fullName: 'Y Nguyên' });
    const update = jest.fn();
    const prisma = {
      refreshToken: { create: jest.fn() },
      user: { findUnique, update },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'Y Nguyên' }),
    } as unknown as ZaloService;
    const svc = new AuthService(prisma, jwt, config, zalo, mkRbac());
    await expect(svc.loginWithZaloMiniApp('code', 'at')).rejects.toThrow('bị khoá');
    expect(update).not.toHaveBeenCalled();
    expect((prisma.refreshToken.create as jest.Mock)).not.toHaveBeenCalled();
  });
});
