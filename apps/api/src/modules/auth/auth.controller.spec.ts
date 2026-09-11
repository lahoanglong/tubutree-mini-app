import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LoginResponse } from '@tubutree/shared-types';
import { AuthController } from './auth.controller';
import { REFRESH_COOKIE } from './refresh-cookie';

const LOGIN: LoginResponse = {
  accessToken: 'at',
  refreshToken: 'rt-secret',
  user: { id: 'u1' } as LoginResponse['user'],
};

function makeRes() {
  const set: { name: string; value: string }[] = [];
  const cleared: string[] = [];
  const res = {
    cookie: (name: string, value: string) => set.push({ name, value }),
    clearCookie: (name: string) => cleared.push(name),
  } as unknown as Response;
  return { res, set, cleared };
}

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe('AuthController — giao refresh token theo client', () => {
  const auth = {
    loginWithZaloMiniApp: jest.fn(),
    loginAsGuest: jest.fn(),
    loginWithZaloOAuth: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const prisma = { user: { findUniqueOrThrow: jest.fn() } };
  const config = { get: jest.fn().mockReturnValue(30) };
  let c: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    c = new AuthController(
      auth as never,
      prisma as never,
      config as never,
    );
  });

  describe('Mini App (không có x-client: web) — hành vi cũ giữ nguyên', () => {
    it('login trả refreshToken trong thân, không set cookie', async () => {
      auth.loginWithZaloMiniApp.mockResolvedValue(LOGIN);
      const { res, set } = makeRes();
      const out = await c.loginZaloMiniApp({ code: 'c' } as never, makeReq(), res);
      expect(out.refreshToken).toBe('rt-secret');
      expect(set).toHaveLength(0);
    });

    it('refresh dùng token trong thân', async () => {
      auth.refresh.mockResolvedValue(LOGIN);
      const { res } = makeRes();
      const out = await c.refresh({ refreshToken: 'from-body' }, makeReq(), res);
      expect(auth.refresh).toHaveBeenCalledWith('from-body');
      expect(out.refreshToken).toBe('rt-secret');
    });
  });

  describe('Web (x-client: web) — refresh token chỉ đi bằng cookie HttpOnly', () => {
    const webReq = (cookie?: string) =>
      makeReq(cookie ? { 'x-client': 'web', cookie } : { 'x-client': 'web' });

    it('login: token vào cookie, thân response KHÔNG còn token', async () => {
      auth.loginWithZaloOAuth.mockResolvedValue(LOGIN);
      const { res, set } = makeRes();
      const out = await c.loginZaloOAuth({ code: 'c' } as never, webReq(), res);
      expect(out.refreshToken).toBe('');
      expect(JSON.stringify(out)).not.toContain('rt-secret');
      expect(set.map((x) => x.name)).toEqual([REFRESH_COOKIE]);
      expect(set[0]!.value).toBe('rt-secret');
    });

    it('login khách cũng theo chế độ cookie', async () => {
      auth.loginAsGuest.mockResolvedValue(LOGIN);
      const { res, set } = makeRes();
      const out = await c.loginGuest({ deviceId: 'd' } as never, webReq(), res);
      expect(out.refreshToken).toBe('');
      expect(set).toHaveLength(1);
    });

    it('refresh đọc token từ cookie khi thân rỗng', async () => {
      auth.refresh.mockResolvedValue(LOGIN);
      const { res, set } = makeRes();
      const out = await c.refresh({}, webReq(`${REFRESH_COOKIE}=cookie-tok`), res);
      expect(auth.refresh).toHaveBeenCalledWith('cookie-tok');
      expect(out.refreshToken).toBe('');
      expect(set.find((x) => x.name === REFRESH_COOKIE)!.value).toBe('rt-secret');
    });

    it('refresh thất bại → xoá cookie, nếu không web thử lại vô hạn mỗi lần mở trang', async () => {
      auth.refresh.mockRejectedValue(new UnauthorizedException());
      const { res, cleared } = makeRes();
      await expect(c.refresh({}, webReq(`${REFRESH_COOKIE}=dead`), res)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(cleared).toEqual([REFRESH_COOKIE]);
    });

    it('logout xoá cookie và thu hồi token trong DB', async () => {
      const { res, cleared } = makeRes();
      await c.logout({}, webReq(`${REFRESH_COOKIE}=tok`), res);
      expect(auth.logout).toHaveBeenCalledWith('tok');
      expect(cleared).toEqual([REFRESH_COOKIE]);
    });

    it('logout khi cookie đã mất: vẫn xoá cookie, không gọi service với undefined', async () => {
      const { res, cleared } = makeRes();
      await c.logout({}, webReq(), res);
      expect(auth.logout).not.toHaveBeenCalled();
      expect(cleared).toEqual([REFRESH_COOKIE]);
    });
  });

  describe('thiếu token ở cả hai đường', () => {
    it('refresh không thân, không cookie → 400 chứ không gọi service với undefined', async () => {
      const { res } = makeRes();
      await expect(c.refresh({}, makeReq(), res)).rejects.toBeInstanceOf(BadRequestException);
      expect(auth.refresh).not.toHaveBeenCalled();
    });

    it('có cookie nhưng thiếu header x-client → coi như không có token (chống CSRF)', async () => {
      const { res } = makeRes();
      await expect(
        c.refresh({}, makeReq({ cookie: `${REFRESH_COOKIE}=tok` }), res),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(auth.refresh).not.toHaveBeenCalled();
    });
  });
});
