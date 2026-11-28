import { BadRequestException, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LoginResponse } from '@tubutree/shared-types';
import { WebLoginController } from './web-login.controller';
import { encodeFlowCookie, GOOGLE_STATE_COOKIE } from './google-oauth.service';
import { REFRESH_COOKIE } from '../refresh-cookie';
import { createValidationPipe } from '../../../common/validation-pipe';
import { EmailOtpVerifyDto, GoogleCallbackDto } from './web-login.dto';

const LOGIN: LoginResponse = { accessToken: 'at', refreshToken: 'rt-secret', user: { id: 'u1' } as LoginResponse['user'] };
const FLOW = { state: 'state-abcdefghijklmnop', verifier: 'verifier-abcdefghijklmnopqrstuvwxyz0123456789', redirectUri: 'https://tubutree.com/dang-nhap/google' };

function makeRes() {
  const cookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const cleared: string[] = [];
  const redirects: { status: number; url: string }[] = [];
  const res = {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => cookies.push({ name, value, opts }),
    clearCookie: (name: string) => cleared.push(name),
    redirect: (status: number, url: string) => redirects.push({ status, url }),
  } as unknown as Response;
  return { res, cookies, cleared, redirects };
}

const req = (headers: Record<string, string> = {}, body: Record<string, unknown> = {}) => ({ headers, body, ip: '1.2.3.4' }) as unknown as Request;

function setup(opts: { googleOn?: boolean; env?: Record<string, unknown> } = {}) {
  const auth = { loginWithVerifiedEmail: jest.fn().mockResolvedValue(LOGIN) };
  const otp = { request: jest.fn().mockResolvedValue({ email: 'a@x.com', resendAfterSec: 60, expiresInSec: 600 }), verify: jest.fn().mockResolvedValue('a@x.com') };
  const google = {
    configured: jest.fn(() => opts.googleOn ?? true),
    start: jest.fn((redirectUri: string) => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', flow: { ...FLOW, redirectUri } })),
    exchange: jest.fn().mockResolvedValue({ email: 'Khach@Gmail.com', name: 'Khách', picture: 'https://lh3.googleusercontent.com/a' }),
  };
  const env: Record<string, unknown> = { NODE_ENV: 'production', CORS_ORIGINS: 'https://tubutree.com,https://app.tubutree.com', JWT_REFRESH_TTL_DAYS: 30, ...opts.env };
  const config = { get: (k: string) => env[k] };
  const c = new WebLoginController(auth as never, otp as never, google as never, config as never);
  return { c, auth, otp, google };
}

describe('POST /auth/email-otp/request + verify', () => {
  it('request chuyển email + khoá IP đã gom cho service', async () => {
    const { c, otp } = setup();
    await c.requestEmailOtp({ email: 'a@x.com' }, req());
    expect(otp.request).toHaveBeenCalledWith('a@x.com', '1.2.3.4');
  });

  it('verify đúng → đăng nhập bằng email đã chuẩn hoá; web (x-client: web) nhận refresh qua cookie HttpOnly, thân không có token', async () => {
    const { c, auth, otp } = setup();
    const { res, cookies } = makeRes();
    const out = await c.verifyEmailOtp({ email: 'A@x.com', code: '123456', referralCode: 'REF1', firstTouch: { source: 'fb' } }, req({ 'x-client': 'web' }), res);
    expect(otp.verify).toHaveBeenCalledWith('A@x.com', '123456');
    expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('a@x.com', { referralCode: 'REF1', firstTouch: { source: 'fb' } });
    expect(out.refreshToken).toBe('');
    expect(cookies.find((k) => k.name === REFRESH_COOKIE)).toMatchObject({ value: 'rt-secret', opts: expect.objectContaining({ httpOnly: true, path: '/api/auth' }) });
  });

  it('verify sai mã → lỗi của service đi thẳng ra, không đăng nhập', async () => {
    const { c, auth, otp } = setup();
    otp.verify.mockRejectedValue(new BadRequestException({ code: 'EMAIL_OTP_WRONG' }));
    await expect(c.verifyEmailOtp({ email: 'a@x.com', code: '000000' }, req({ 'x-client': 'web' }), makeRes().res)).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.loginWithVerifiedEmail).not.toHaveBeenCalled();
  });

  it('DTO: mã phải đúng 6 chữ số', async () => {
    const pipe = createValidationPipe();
    const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: EmailOtpVerifyDto });
    await expect(run({ email: 'a@x.com', code: '12345' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ email: 'a@x.com', code: '12345a' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ email: 'a@x.com', code: ' 123456' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ email: 'a@x.com', code: '123456' })).resolves.toBeTruthy();
  });
});

describe('GET /auth/google/start', () => {
  it('redirect_uri là trang /dang-nhap/google của web shop → đặt cookie lượt đăng nhập (HttpOnly, 10 phút) rồi 302 sang Google', () => {
    const { c, google } = setup();
    const { res, cookies, redirects } = makeRes();
    c.googleStart('https://tubutree.com/dang-nhap/google', res);
    expect(google.start).toHaveBeenCalledWith('https://tubutree.com/dang-nhap/google');
    expect(redirects).toEqual([{ status: 302, url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }]);
    const ck = cookies.find((k) => k.name === GOOGLE_STATE_COOKIE)!;
    expect(ck.opts).toMatchObject({ httpOnly: true, path: '/api/auth', maxAge: 600_000 });
    expect(ck.value.startsWith(`${FLOW.state}.${FLOW.verifier}.`)).toBe(true);
  });

  it.each([
    ['origin lạ', 'https://evil.example/dang-nhap/google'],
    ['đường khác', 'https://tubutree.com/tai-khoan'],
    ['kèm query', 'https://tubutree.com/dang-nhap/google?next=https://evil.example'],
    ['http ở production', 'http://tubutree.com/dang-nhap/google'],
    ['localhost ở production', 'http://localhost:3000/dang-nhap/google'],
    ['thiếu', undefined],
    ['không phải URL', 'dang-nhap/google'],
  ])('%s → 400, không đặt cookie, không chuyển hướng', (_n, uri) => {
    const { c, google } = setup();
    const { res, cookies, redirects } = makeRes();
    expect(() => c.googleStart(uri, res)).toThrow(BadRequestException);
    expect(google.start).not.toHaveBeenCalled();
    expect(cookies).toHaveLength(0);
    expect(redirects).toHaveLength(0);
  });

  it('dev: localhost được phép', () => {
    const { c } = setup({ env: { NODE_ENV: 'development', CORS_ORIGINS: '' } });
    const { res, redirects } = makeRes();
    c.googleStart('http://localhost:3112/dang-nhap/google', res);
    expect(redirects).toHaveLength(1);
  });

  it('chưa có khoá Google → quay về trang web với ?error=google_unavailable, không đặt cookie', () => {
    const { c, google } = setup({ googleOn: false });
    const { res, cookies, redirects } = makeRes();
    c.googleStart('https://tubutree.com/dang-nhap/google', res);
    expect(google.start).not.toHaveBeenCalled();
    expect(cookies).toHaveLength(0);
    expect(redirects).toEqual([{ status: 302, url: 'https://tubutree.com/dang-nhap/google?error=google_unavailable' }]);
  });
});

describe('POST /auth/google/callback', () => {
  const cookieHeader = (flow = FLOW) => `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(encodeFlowCookie(flow))}; other=1`;

  async function statusOf(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), code: (e.getResponse() as { code?: unknown }).code };
      throw e;
    }
    throw new Error('không ném lỗi');
  }

  it('cookie khớp state → đổi mã với đúng lượt, đăng nhập bằng email Google đã chuẩn hoá (kèm tên/ảnh), xoá cookie lượt, refresh qua cookie', async () => {
    const { c, google, auth } = setup();
    const { res, cookies, cleared } = makeRes();
    const out = await c.googleCallback({ code: 'gcode', state: FLOW.state, referralCode: 'R' }, req({ 'x-client': 'web', cookie: cookieHeader() }), res);
    expect(google.exchange).toHaveBeenCalledWith('gcode', FLOW);
    expect(auth.loginWithVerifiedEmail).toHaveBeenCalledWith('khach@gmail.com', { name: 'Khách', avatarUrl: 'https://lh3.googleusercontent.com/a', referralCode: 'R', firstTouch: undefined });
    expect(cleared).toContain(GOOGLE_STATE_COOKIE);
    expect(out.refreshToken).toBe('');
    expect(cookies.some((k) => k.name === REFRESH_COOKIE && k.value === 'rt-secret')).toBe(true);
  });

  it('không có cookie lượt (trình duyệt khác bấm link callback) → 401 GOOGLE_STATE_MISMATCH, không đổi mã', async () => {
    const { c, google } = setup();
    expect(await statusOf(c.googleCallback({ code: 'gcode', state: FLOW.state }, req({ 'x-client': 'web' }), makeRes().res))).toEqual({ status: 401, code: 'GOOGLE_STATE_MISMATCH' });
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it('state khác cookie → 401, vẫn xoá cookie lượt (không dùng lại được)', async () => {
    const { c, google } = setup();
    const { res, cleared } = makeRes();
    expect((await statusOf(c.googleCallback({ code: 'gcode', state: 'state-zzzzzzzzzzzzzzzz' }, req({ 'x-client': 'web', cookie: cookieHeader() }), res))).status).toBe(401);
    expect(cleared).toContain(GOOGLE_STATE_COOKIE);
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it('cookie mang redirect_uri lạ (bị sửa tay) → 401', async () => {
    const { c, google } = setup();
    const bad = { ...FLOW, redirectUri: 'https://evil.example/dang-nhap/google' };
    expect((await statusOf(c.googleCallback({ code: 'g', state: FLOW.state }, req({ 'x-client': 'web', cookie: cookieHeader(bad) }), makeRes().res))).status).toBe(401);
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it('thiếu header x-client: web → 400 (đường này chỉ cho web, header ép preflight chặn trang lạ)', async () => {
    const { c, google } = setup();
    await expect(c.googleCallback({ code: 'g', state: FLOW.state }, req({ cookie: cookieHeader() }), makeRes().res)).rejects.toBeInstanceOf(BadRequestException);
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it('DTO: thiếu code/state → 400', async () => {
    const pipe = createValidationPipe();
    await expect(pipe.transform({ state: 's' }, { type: 'body', metatype: GoogleCallbackDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ code: 'c' }, { type: 'body', metatype: GoogleCallbackDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
