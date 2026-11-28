import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { LoginResponse } from '@tubutree/shared-types';
import type { Env } from '../../../config/env.validation';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthThrottle, throttleIpTracker, type AuthIdentity } from '../../../common/throttle/throttle.config';
import { buildCorsPolicy, staticWebOrigins, type CorsPolicy } from '../../../common/cors';
import { AuthService } from '../auth.service';
import { cookieBase, deliverRefreshToken, readCookie, wantsCookieAuth } from '../refresh-cookie';
import { EmailOtpService, type EmailOtpRequestResult } from './email-otp.service';
import { normalizeEmail } from './email-otp.rules';
import {
  decodeFlowCookie,
  encodeFlowCookie,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CODE_MESSAGE,
  GOOGLE_SESSION_MESSAGE,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_TTL_MS,
  GoogleOAuthService,
  sameState,
} from './google-oauth.service';
import { EmailOtpRequestDto, EmailOtpVerifyDto, GoogleCallbackDto } from './web-login.dto';

function bodyField(req: Request, field: string): string | undefined {
  const v = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Đếm theo hộp thư (đã chuẩn hoá) chứ không theo IP: nhiều máy chung wifi/CGNAT không ăn chung suất; IP là trần nới rộng của AuthThrottle.
const emailIdentity: AuthIdentity = (req) => {
  const raw = bodyField(req, 'email');
  return raw ? (normalizeEmail(raw) ?? raw.trim().toLowerCase()) : undefined;
};
const googleIdentity: AuthIdentity = (req) => bodyField(req, 'state');

/**
 * Đăng nhập trên web không cần Zalo: mã 6 số qua email và Google. Cấp đúng cặp token + cookie refresh như /auth/zalo-oauth, nên giỏ,
 * đơn, quét mã, Điểm Xanh và Vườn Xanh chạy y như tài khoản Zalo.
 */
@Controller('auth')
export class WebLoginController {
  private readonly isWebOrigin: CorsPolicy['isWebOrigin'];

  constructor(
    private readonly auth: AuthService,
    private readonly otp: EmailOtpService,
    private readonly google: GoogleOAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    this.isWebOrigin = buildCorsPolicy(isProd, staticWebOrigins(this.config.get('CORS_ORIGINS', { infer: true }))).isWebOrigin;
  }

  private refreshTtlDays(): number {
    return this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
  }

  /** Chỉ trang /dang-nhap/google của chính web shop (CORS_ORIGINS, gian hàng, localhost khi dev); mọi thứ khác là null. */
  private googleCallbackUrl(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length > 512) return null;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.pathname !== GOOGLE_CALLBACK_PATH || u.search || u.hash || u.username || u.password) return null;
    if (!this.isWebOrigin(u.origin)) return null;
    return `${u.origin}${GOOGLE_CALLBACK_PATH}`;
  }

  /** POST /api/auth/email-otp/request — gửi mã 6 số tới email. Không bao giờ trả mã trong thân. */
  @Public()
  @AuthThrottle(emailIdentity)
  @Post('email-otp/request')
  @HttpCode(HttpStatus.OK)
  requestEmailOtp(@Body() dto: EmailOtpRequestDto, @Req() req: Request): Promise<EmailOtpRequestResult> {
    return this.otp.request(dto.email, throttleIpTracker(req));
  }

  /** POST /api/auth/email-otp/verify — mã đúng thì đăng nhập (tài khoản có sẵn theo email, hoặc tạo mới). */
  @Public()
  @AuthThrottle(emailIdentity)
  @Post('email-otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmailOtp(@Body() dto: EmailOtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const email = await this.otp.verify(dto.email, dto.code);
    const r = await this.auth.loginWithVerifiedEmail(email, { referralCode: dto.referralCode, firstTouch: dto.firstTouch });
    return deliverRefreshToken(req, res, r, this.refreshTtlDays());
  }

  /**
   * GET /api/auth/google/start?redirect_uri=<web>/dang-nhap/google — trình duyệt mở thẳng (điều hướng cấp cao): đặt cookie lượt đăng
   * nhập rồi chuyển tới Google. Chưa cấu hình Google thì quay về trang web với `?error=google_unavailable` để trang nói rõ.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('google/start')
  googleStart(@Query('redirect_uri') redirectUri: string | undefined, @Res() res: Response): void {
    const target = this.googleCallbackUrl(redirectUri);
    if (!target) throw new BadRequestException('Địa chỉ quay lại sau khi đăng nhập Google không hợp lệ.');
    if (!this.google.configured()) {
      res.redirect(HttpStatus.FOUND, `${target}?error=google_unavailable`);
      return;
    }
    const { url, flow } = this.google.start(target);
    res.cookie(GOOGLE_STATE_COOKIE, encodeFlowCookie(flow), { ...cookieBase(), maxAge: GOOGLE_STATE_TTL_MS });
    res.redirect(HttpStatus.FOUND, url);
  }

  /** POST /api/auth/google/callback — trang /dang-nhap/google gửi `code` + `state`; chỉ trình duyệt đã bấm "Đăng nhập với Google" (có cookie) mới qua. */
  @Public()
  @AuthThrottle(googleIdentity)
  @Post('google/callback')
  @HttpCode(HttpStatus.OK)
  async googleCallback(@Body() dto: GoogleCallbackDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    // Header tuỳ biến ép preflight nên trang lạ không POST được kèm cookie; Mini App không dùng đường này.
    if (!wantsCookieAuth(req)) throw new BadRequestException('Đăng nhập Google chỉ dùng trên web.');
    const flow = decodeFlowCookie(readCookie(req, GOOGLE_STATE_COOKIE));
    res.clearCookie(GOOGLE_STATE_COOKIE, cookieBase());
    if (!flow || !sameState(flow.state, dto.state) || this.googleCallbackUrl(flow.redirectUri) !== flow.redirectUri) {
      throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'GOOGLE_STATE_MISMATCH', message: GOOGLE_SESSION_MESSAGE });
    }
    const profile = await this.google.exchange(dto.code, flow);
    const email = normalizeEmail(profile.email);
    if (!email) throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'GOOGLE_CODE_REJECTED', message: GOOGLE_CODE_MESSAGE });
    const r = await this.auth.loginWithVerifiedEmail(email, {
      name: profile.name,
      avatarUrl: profile.picture,
      referralCode: dto.referralCode,
      firstTouch: dto.firstTouch,
    });
    return deliverRefreshToken(req, res, r, this.refreshTtlDays());
  }
}
