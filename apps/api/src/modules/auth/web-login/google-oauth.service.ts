import { HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../../config/env.validation';
import { safeEqualStrings } from '../../../common/safe-equal';
import { googleLoginConfigured } from './web-login-config';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Trang web nhận `?code&state` từ Google rồi POST /auth/google/callback; phải khai đúng đường này trong Google Cloud Console. */
export const GOOGLE_CALLBACK_PATH = '/dang-nhap/google';
/** Cookie HttpOnly giữ state + code_verifier của lượt đăng nhập; trình duyệt khác (kẻ dụ bấm link) không có cookie này. */
export const GOOGLE_STATE_COOKIE = 'tubu_goauth';
export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const GOOGLE_DISABLED_MESSAGE = 'Đăng nhập Google chưa được bật.';
export const GOOGLE_SESSION_MESSAGE = 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Bạn đăng nhập lại nhé.';
export const GOOGLE_CODE_MESSAGE = 'Mã đăng nhập Google không hợp lệ hoặc đã hết hạn. Bạn đăng nhập lại nhé.';
export const GOOGLE_UNVERIFIED_MESSAGE = 'Email Google của bạn chưa được xác minh. Bạn đăng nhập bằng mã gửi qua Email nhé.';
export const GOOGLE_BUSY_MESSAGE = 'Google đang bận, bạn thử lại sau ít phút nhé.';

export interface GoogleProfile {
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleFlow {
  state: string;
  verifier: string;
  redirectUri: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function encodeFlowCookie(flow: GoogleFlow): string {
  return `${flow.state}.${flow.verifier}.${b64url(Buffer.from(flow.redirectUri, 'utf8'))}`;
}

export function decodeFlowCookie(raw: string | undefined): GoogleFlow | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]{16,}$/.test(p))) return null;
  const [state, verifier, uri] = parts as [string, string, string];
  return { state, verifier, redirectUri: Buffer.from(uri, 'base64url').toString('utf8') };
}

/** So state của trình duyệt (cookie) với state Google gửi lại, không lộ thời gian so. */
export function sameState(a: string, b: string): boolean {
  return safeEqualStrings(a, b);
}

/** Phần thân (claims) của id_token. Không cần kiểm chữ ký: token nhận thẳng từ Google qua TLS bằng client secret (OIDC Core 3.1.3.7). */
export function decodeIdToken(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type IdTokenCheck = { ok: true; profile: GoogleProfile } | { ok: false; reason: 'invalid' | 'unverified' };

export function profileFromClaims(claims: Record<string, unknown> | null, clientId: string, nowMs: number): IdTokenCheck {
  if (!claims) return { ok: false, reason: 'invalid' };
  const aud = claims.aud;
  const audOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
  if (!audOk || !GOOGLE_ISSUERS.has(String(claims.iss)) || exp + 60_000 < nowMs) return { ok: false, reason: 'invalid' };
  const email = typeof claims.email === 'string' ? claims.email : '';
  if (!email) return { ok: false, reason: 'invalid' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'unverified' };
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 100) : undefined;
  const picture = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : undefined;
  return { ok: true, profile: { email, ...(name ? { name } : {}), ...(picture ? { picture } : {}) } };
}

/**
 * Đăng nhập Google trên web: OAuth 2.0 Authorization Code + PKCE (S256) + state. Chỉ bật khi có cả GOOGLE_CLIENT_ID và
 * GOOGLE_CLIENT_SECRET. Đổi mã xong chỉ lấy email đã được Google xác minh, rồi đi chung đường đăng nhập email (cùng tài khoản).
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private creds(): { id: string; secret: string } {
    const id = this.config.get('GOOGLE_CLIENT_ID', { infer: true })?.trim() ?? '';
    const secret = this.config.get('GOOGLE_CLIENT_SECRET', { infer: true })?.trim() ?? '';
    if (!googleLoginConfigured({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret })) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'GOOGLE_LOGIN_DISABLED', message: GOOGLE_DISABLED_MESSAGE });
    }
    return { id, secret };
  }

  configured(): boolean {
    try {
      this.creds();
      return true;
    } catch {
      return false;
    }
  }

  /** URL trang chọn tài khoản của Google và lượt đăng nhập cần cất vào cookie. `redirectUri` phải được người gọi kiểm trước. */
  start(redirectUri: string): { url: string; flow: GoogleFlow } {
    const { id } = this.creds();
    const flow: GoogleFlow = { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), redirectUri };
    const q = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${GOOGLE_AUTH_URL}?${q.toString()}`, flow };
  }

  async exchange(code: string, flow: GoogleFlow): Promise<GoogleProfile> {
    const { id, secret } = this.creds();
    let idToken: unknown;
    try {
      const body = new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: flow.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      });
      const res = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000,
      });
      idToken = (res.data as { id_token?: unknown } | null)?.id_token;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const ax = err as AxiosError<{ error?: string }>;
      const status = ax.response?.status;
      if (status === undefined || status >= 500 || status === 429) {
        this.logger.error(`Google token endpoint không trả lời được: ${ax.message}`);
        throw new ServiceUnavailableException(GOOGLE_BUSY_MESSAGE);
      }
      this.logger.warn(`Google từ chối đổi mã: HTTP ${status} ${ax.response?.data?.error ?? ''}`.trim());
      throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'GOOGLE_CODE_REJECTED', message: GOOGLE_CODE_MESSAGE });
    }
    const check = profileFromClaims(decodeIdToken(idToken), id, Date.now());
    if (!check.ok) {
      if (check.reason === 'unverified') {
        throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'GOOGLE_EMAIL_UNVERIFIED', message: GOOGLE_UNVERIFIED_MESSAGE });
      }
      this.logger.warn('Google trả id_token không hợp lệ (aud/iss/exp/email)');
      throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'GOOGLE_CODE_REJECTED', message: GOOGLE_CODE_MESSAGE });
    }
    return check.profile;
  }
}
