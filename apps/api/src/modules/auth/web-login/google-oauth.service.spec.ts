import { HttpException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';
import {
  decodeFlowCookie,
  encodeFlowCookie,
  GOOGLE_TOKEN_URL,
  GoogleOAuthService,
  profileFromClaims,
  sameState,
} from './google-oauth.service';
import { googleLoginConfigured } from './web-login-config';

const CLIENT_ID = 'cid.apps.googleusercontent.com';

function svc(env: Record<string, string> = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'gsecret-value' }) {
  return new GoogleOAuthService({ get: (k: string) => env[k] ?? '' } as unknown as ConfigService<never, true>);
}

function idToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

const now = Date.now();
const goodClaims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(now / 1000) + 600, email: 'Khach@Gmail.com', email_verified: true, name: 'Khách Google', picture: 'https://lh3.googleusercontent.com/a/x' };

async function statusOf(p: Promise<unknown>): Promise<{ status: number; code?: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), code: (e.getResponse() as { code?: unknown }).code };
    throw e;
  }
  throw new Error('không ném lỗi');
}

describe('googleLoginConfigured — chỉ bật khi có đủ hai khoá', () => {
  it.each([
    [{}, false],
    [{ GOOGLE_CLIENT_ID: CLIENT_ID }, false],
    [{ GOOGLE_CLIENT_SECRET: 's' }, false],
    [{ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: 's' }, false],
    [{ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 's' }, true],
  ])('%j → %s', (env, want) => {
    expect(googleLoginConfigured(env)).toBe(want);
    expect(svc(env as Record<string, string>).configured()).toBe(want);
  });

  it('chưa cấu hình: start/exchange ném 404 GOOGLE_LOGIN_DISABLED', async () => {
    const s = svc({});
    expect(() => s.start('http://localhost:3000/dang-nhap/google')).toThrow(NotFoundException);
    await expect(s.exchange('c', { state: 's', verifier: 'v', redirectUri: 'r' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GoogleOAuthService.start — PKCE S256 + state', () => {
  it('URL Google có client_id, redirect_uri, state, code_challenge = S256(verifier), scope openid email profile', () => {
    const { url, flow } = svc().start('https://tubutree.com/dang-nhap/google');
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('https://tubutree.com/dang-nhap/google');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe(flow.state);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(flow.verifier).digest('base64url'));
    expect(url).not.toContain(flow.verifier);
    expect(url).not.toContain('gsecret-value');
    expect(flow.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('mỗi lượt một state/verifier mới', () => {
    const a = svc().start('https://tubutree.com/dang-nhap/google').flow;
    const b = svc().start('https://tubutree.com/dang-nhap/google').flow;
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('cookie lượt đăng nhập mã hoá/giải mã đúng; chuỗi hỏng → null', () => {
    const flow = svc().start('https://tubutree.com/dang-nhap/google').flow;
    expect(decodeFlowCookie(encodeFlowCookie(flow))).toEqual(flow);
    for (const bad of [undefined, '', 'a.b', 'x.y.z', `${flow.state}.${flow.verifier}`, `${flow.state}.<script>.${flow.verifier}`]) expect(decodeFlowCookie(bad)).toBeNull();
    expect(sameState(flow.state, flow.state)).toBe(true);
    expect(sameState(flow.state, `${flow.state}x`)).toBe(false);
  });
});

describe('profileFromClaims — chỉ nhận email Google đã xác minh của đúng ứng dụng', () => {
  it('hợp lệ → email, tên, ảnh https', () => {
    expect(profileFromClaims(goodClaims, CLIENT_ID, now)).toEqual({ ok: true, profile: { email: 'Khach@Gmail.com', name: 'Khách Google', picture: goodClaims.picture } });
  });
  it.each([
    ['aud của ứng dụng khác', { aud: 'other' }],
    ['iss lạ', { iss: 'https://evil.example' }],
    ['hết hạn', { exp: Math.floor(now / 1000) - 3600 }],
    ['thiếu email', { email: undefined }],
  ])('%s → invalid', (_n, patch) => {
    expect(profileFromClaims({ ...goodClaims, ...patch }, CLIENT_ID, now)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('email_verified false → unverified', () => {
    expect(profileFromClaims({ ...goodClaims, email_verified: false }, CLIENT_ID, now)).toEqual({ ok: false, reason: 'unverified' });
  });
});

describe('GoogleOAuthService.exchange', () => {
  let post: jest.SpyInstance;
  beforeEach(() => {
    post = jest.spyOn(axios, 'post');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const flow = { state: 'state-value-123456', verifier: 'verifier-value-abcdefghijklmnopqrstuvwxyz0123', redirectUri: 'https://tubutree.com/dang-nhap/google' };

  it('gửi code + code_verifier + redirect_uri đúng lượt; trả hồ sơ từ id_token', async () => {
    post.mockResolvedValue({ data: { access_token: 'at', id_token: idToken(goodClaims) } });
    const p = await svc().exchange('auth-code', flow);
    expect(p.email).toBe('Khach@Gmail.com');
    const [calledUrl, body] = post.mock.calls[0] as [string, string];
    expect(calledUrl).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(body);
    expect(form.get('code')).toBe('auth-code');
    expect(form.get('code_verifier')).toBe(flow.verifier);
    expect(form.get('redirect_uri')).toBe(flow.redirectUri);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe(CLIENT_ID);
  });

  it('Google từ chối mã (400 invalid_grant) → 401 GOOGLE_CODE_REJECTED', async () => {
    post.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    expect(await statusOf(svc().exchange('c', flow))).toEqual({ status: 401, code: 'GOOGLE_CODE_REJECTED' });
  });

  it('Google lỗi 5xx/mất mạng → 503', async () => {
    post.mockRejectedValue(Object.assign(new Error('socket hang up'), { response: undefined }));
    await expect(svc().exchange('c', flow)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('email chưa xác minh → 401 GOOGLE_EMAIL_UNVERIFIED; id_token sai aud → GOOGLE_CODE_REJECTED', async () => {
    post.mockResolvedValueOnce({ data: { id_token: idToken({ ...goodClaims, email_verified: false }) } });
    expect(await statusOf(svc().exchange('c', flow))).toEqual({ status: 401, code: 'GOOGLE_EMAIL_UNVERIFIED' });
    post.mockResolvedValueOnce({ data: { id_token: idToken({ ...goodClaims, aud: 'x' }) } });
    expect(await statusOf(svc().exchange('c', flow))).toEqual({ status: 401, code: 'GOOGLE_CODE_REJECTED' });
  });
});
