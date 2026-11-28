import { Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZaloService } from './zalo.service';
import type { RbacService } from '../staff/rbac/rbac.service';
import type { VouchersService } from '../vouchers/vouchers.service';
import { emailLoginZaloId } from './web-login/email-otp.rules';
import { isRealUser } from '../../common/real-user';

const configValues: Record<string, unknown> = { JWT_ACCESS_SECRET: 'access-secret', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };

function setup(users: { findUnique?: jest.Mock; findMany?: jest.Mock; create?: jest.Mock; update?: jest.Mock } = {}) {
  const user = {
    findUnique: users.findUnique ?? jest.fn().mockResolvedValue(null),
    findMany: users.findMany ?? jest.fn().mockResolvedValue([]),
    create: users.create ?? jest.fn().mockImplementation(({ data }) => ({ id: 'new-u', role: 'CUSTOMER', isBlocked: false, mergedIntoId: null, phone: null, ...data })),
    update: users.update ?? jest.fn().mockImplementation(({ where, data }) => ({ id: where.id, role: 'CUSTOMER', ...data })),
  };
  const prisma = { user, refreshToken: { create: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
  const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
  const vouchers = { grantWelcomeNow: jest.fn().mockResolvedValue(true) };
  const rbac = { applyGrants: jest.fn(async (u: unknown) => u) } as unknown as RbacService;
  const svc = new AuthService(prisma, jwt, config, {} as ZaloService, rbac, undefined, vouchers as unknown as VouchersService);
  return { svc, user, vouchers, jwt };
}

describe('AuthService.loginWithVerifiedEmail', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lần đầu: tạo tài khoản email (zaloId email_<băm>, lưu email) là user thật, cấp quà chào mừng, trả đúng cặp token như Zalo', async () => {
    const { svc, user, vouchers } = setup();
    const res = await svc.loginWithVerifiedEmail('khach@gmail.com', { referralCode: undefined, firstTouch: { source: 'facebook' } });
    expect(user.create).toHaveBeenCalledTimes(1);
    const data = user.create.mock.calls[0][0].data;
    expect(data.zaloId).toBe(emailLoginZaloId('khach@gmail.com'));
    expect(data.email).toBe('khach@gmail.com');
    expect(isRealUser({ zaloId: data.zaloId, phone: null })).toBe(true);
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledWith('new-u', { becameRealNow: true });
    expect(res.accessToken).toBe('access-jwt');
    expect(res.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.user.id).toBe('new-u');
  });

  it('đăng nhập lại cùng hộp thư → đúng tài khoản cũ, không tạo, không cấp quà lần nữa', async () => {
    const existing = { id: 'email-u', role: 'CUSTOMER', zaloId: emailLoginZaloId('ab@gmail.com'), fullName: 'An', avatarUrl: null, isBlocked: false, mergedIntoId: null };
    const { svc, user, vouchers } = setup({ findUnique: jest.fn().mockResolvedValue(existing) });
    const res = await svc.loginWithVerifiedEmail('a.b+shop@gmail.com');
    expect(user.findUnique).toHaveBeenCalledWith({ where: { zaloId: emailLoginZaloId('ab@gmail.com') } });
    expect(res.user.id).toBe('email-u');
    expect(user.create).not.toHaveBeenCalled();
    expect(vouchers.grantWelcomeNow).not.toHaveBeenCalled();
  });

  it('khách Zalo đã khai đúng email trong hồ sơ → vào chính tài khoản Zalo đó (giữ điểm/đơn), không tạo tài khoản mới', async () => {
    const zaloUser = { id: 'zalo-u', role: 'CUSTOMER', zaloId: '8812345', email: 'Khach@Gmail.com', phoneVerifiedAt: new Date(), isBlocked: false, mergedIntoId: null };
    const { svc, user } = setup({ findMany: jest.fn().mockResolvedValue([zaloUser]) });
    const res = await svc.loginWithVerifiedEmail('khach@gmail.com');
    expect(res.user.id).toBe('zalo-u');
    expect(user.create).not.toHaveBeenCalled();
    const where = user.findMany.mock.calls[0][0].where;
    expect(where.email).toEqual({ equals: 'khach@gmail.com', mode: 'insensitive' });
    expect(where.mergedIntoId).toBeNull();
    // Tài khoản có quyền (nhân viên, admin) chỉ vào bằng Zalo; dòng khách vãng lai và tài khoản email khác không bao giờ được ghép theo email hồ sơ.
    expect(where.role).toEqual({ in: ['CUSTOMER', 'AFFILIATE', 'DEALER'] });
    expect(where.NOT).toEqual([{ zaloId: { startsWith: 'guest_' } }, { zaloId: { startsWith: 'email_' } }]);
  });

  it('nhiều tài khoản Zalo cùng email hồ sơ → chọn tài khoản có SĐT đã xác minh', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const rows = [
      { id: 'old-unverified', role: 'CUSTOMER', zaloId: '1', phoneVerifiedAt: null, isBlocked: false, mergedIntoId: null },
      { id: 'verified', role: 'CUSTOMER', zaloId: '2', phoneVerifiedAt: new Date(), isBlocked: false, mergedIntoId: null },
    ];
    const { svc } = setup({ findMany: jest.fn().mockResolvedValue(rows) });
    expect((await svc.loginWithVerifiedEmail('a@x.com')).user.id).toBe('verified');
  });

  it('tài khoản bị khoá → vẫn bị chặn (ACCOUNT_BLOCKED), không mở tài khoản mới để lách khoá', async () => {
    const blocked = { id: 'zalo-b', role: 'CUSTOMER', zaloId: '9', phoneVerifiedAt: null, isBlocked: true, mergedIntoId: null };
    const { svc, user } = setup({ findMany: jest.fn().mockResolvedValue([blocked]) });
    await expect(svc.loginWithVerifiedEmail('a@x.com')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.create).not.toHaveBeenCalled();
  });

  it('hai lần xác minh đồng thời cùng hộp thư (P2002 trên zaloId) → dùng tài khoản lần kia vừa tạo', async () => {
    const winner = { id: 'winner', role: 'CUSTOMER', zaloId: emailLoginZaloId('a@x.com'), isBlocked: false, mergedIntoId: null };
    const findUnique = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(winner);
    const create = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    const { svc } = setup({ findUnique, create });
    expect((await svc.loginWithVerifiedEmail('a@x.com')).user.id).toBe('winner');
  });

  it('Google: điền tên/ảnh cho tài khoản email còn trống, không ghi đè tên khách đã tự đặt', async () => {
    const blank = { id: 'e1', role: 'CUSTOMER', zaloId: emailLoginZaloId('a@x.com'), fullName: null, avatarUrl: null, isBlocked: false, mergedIntoId: null };
    const a = setup({ findUnique: jest.fn().mockResolvedValue(blank) });
    await a.svc.loginWithVerifiedEmail('a@x.com', { name: 'Google Name', avatarUrl: 'https://lh3.googleusercontent.com/x' });
    expect(a.user.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { fullName: 'Google Name', avatarUrl: 'https://lh3.googleusercontent.com/x' } });

    const named = { ...blank, fullName: 'Tên tự đặt', avatarUrl: 'https://x/y.png' };
    const b = setup({ findUnique: jest.fn().mockResolvedValue(named) });
    await b.svc.loginWithVerifiedEmail('a@x.com', { name: 'Google Name', avatarUrl: 'https://lh3.googleusercontent.com/x' });
    expect(b.user.update).not.toHaveBeenCalled();
  });

  it('tài khoản mới qua Google mang tên/ảnh Google', async () => {
    const { svc, user } = setup();
    await svc.loginWithVerifiedEmail('g@gmail.com', { name: 'G', avatarUrl: 'https://lh3.googleusercontent.com/g' });
    expect(user.create.mock.calls[0][0].data).toMatchObject({ fullName: 'G', avatarUrl: 'https://lh3.googleusercontent.com/g' });
  });
});
