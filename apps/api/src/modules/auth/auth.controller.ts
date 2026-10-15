import { Body, Controller, Get, Post, HttpCode, HttpStatus, Req, Res, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import type { JwtPayload, LoginResponse } from '@tubutree/shared-types';
import type { Env } from '../../config/env.validation';
import { Public } from '../../common/decorators/public.decorator';
import { AuthThrottle, type AuthIdentity } from '../../common/throttle/throttle.config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import {
  clearRefreshCookies,
  readRefreshCookie,
  setRefreshCookies,
  wantsCookieAuth,
} from './refresh-cookie';
import { ZaloMiniAppLoginDto } from './dto/zalo-login.dto';
import { ZaloOAuthDto } from './dto/zalo-oauth.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { EnsurePhoneDto } from './dto/ensure-phone.dto';

class GuestLoginDto {
  // deviceId là thứ DUY NHẤT xác thực tài khoản khách (xem apps/miniapp/src/utils/idempotency.ts
  // newDeviceId(): luôn dạng `d_<uuid|hex|base36>` — chỉ gồm chữ/số/`_`/`-`, dài 34-38 ký tự).
  // Ràng buộc định dạng + độ dài ở đây để BE không tin mù một chuỗi tuỳ ý làm định danh xác thực.
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128) @Matches(/^[A-Za-z0-9_-]+$/)
  deviceId!: string;
  @IsString() @IsOptional() referralCode?: string;
}

function bodyField(req: Request, field: string): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const v = body?.[field];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Khoá đếm theo định danh của chính người đăng nhập, không theo IP: nhiều máy chung wifi/CGNAT
// không được ăn chung 1 suất. IP chỉ còn là trần nới rộng (xem AuthThrottle).
const guestIdentity: AuthIdentity = (req) => bodyField(req, 'deviceId');
const zaloMiniAppIdentity: AuthIdentity = (req) => bodyField(req, 'accessToken') ?? bodyField(req, 'code');
const zaloOAuthIdentity: AuthIdentity = (req) => bodyField(req, 'code');
const refreshIdentity: AuthIdentity = (req) => bodyField(req, 'refreshToken') ?? readRefreshCookie(req);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Web shop (`x-client: web`) nhận refresh token qua cookie `HttpOnly` và KHÔNG thấy nó trong
   * thân response — xem `refresh-cookie.ts` để biết vì sao. Mini App Zalo không gửi header này
   * nên vẫn nhận token trong thân như cũ; đổi một đầu không làm chết đầu kia.
   */
  private withRefreshDelivery(req: Request, res: Response, result: LoginResponse): LoginResponse {
    if (!wantsCookieAuth(req)) return result;
    const ttlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    setRefreshCookies(res, result.refreshToken, ttlDays);
    return { ...result, refreshToken: '' };
  }

  @Public()
  @AuthThrottle(zaloMiniAppIdentity)
  @Post('zalo-mini-app')
  @HttpCode(HttpStatus.OK)
  async loginZaloMiniApp(
    @Body() dto: ZaloMiniAppLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.loginWithZaloMiniApp(dto.code, dto.accessToken, dto.phoneToken, dto.referralCode);
    return this.withRefreshDelivery(req, res, r);
  }

  /** Đăng nhập khách theo deviceId (fallback khi Zalo login chưa khả dụng). */
  @Public()
  @AuthThrottle(guestIdentity)
  @Post('guest')
  @HttpCode(HttpStatus.OK)
  async loginGuest(
    @Body() dto: GuestLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.loginAsGuest(dto.deviceId, dto.referralCode);
    return this.withRefreshDelivery(req, res, r);
  }

  @Public()
  @AuthThrottle(zaloOAuthIdentity)
  @Post('zalo-oauth')
  @HttpCode(HttpStatus.OK)
  async loginZaloOAuth(
    @Body() dto: ZaloOAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.loginWithZaloOAuth(dto.code, dto.codeVerifier, dto.referralCode);
    return this.withRefreshDelivery(req, res, r);
  }

  @Public()
  @AuthThrottle(refreshIdentity)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const token = dto.refreshToken ?? readRefreshCookie(req);
    if (!token) throw new BadRequestException('Thiếu refresh token.');
    try {
      return this.withRefreshDelivery(req, res, await this.auth.refresh(token));
    } catch (e) {
      // Token trong cookie đã chết (hết hạn / bị thu hồi / reuse) — xoá cookie ngay. Để lại
      // thì trình duyệt vẫn gửi kèm nó ở mọi lần mở trang, mỗi lần lại một lượt 401 vô ích.
      // Chỉ khi chắc chắn token chết (401); lỗi tạm thời (DB, mạng) mà xoá thì khách mất phiên còn hợp lệ.
      if (e instanceof UnauthorizedException && wantsCookieAuth(req)) clearRefreshCookies(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = dto.refreshToken ?? readRefreshCookie(req);
    if (wantsCookieAuth(req)) clearRefreshCookies(res);
    if (token) await this.auth.logout(token);
  }

  /** GET /api/auth/me — yêu cầu JWT (guard mặc định). */
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    return this.auth.toAuthUser(dbUser);
  }

  /**
   * POST /api/auth/ensure-phone — yêu cầu JWT (guard mặc định, KHÔNG @Public()). A7-01: khác
   * /auth/zalo-mini-app (public, không biết phiên hiện tại là ai), route này luôn có
   * `@CurrentUser()` từ JWT đã xác thực nên AuthService biết chính xác đang là ai và không bao
   * giờ âm thầm đổi sang user khác. Dùng cho cả 2 nơi: checkout xin SĐT (kèm phoneToken) và
   * nâng cấp ngầm phiên khách ở store/auth.ts restore() (không kèm phoneToken).
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('ensure-phone')
  @HttpCode(HttpStatus.OK)
  async ensurePhone(
    @CurrentUser() user: JwtPayload,
    @Body() dto: EnsurePhoneDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.ensurePhoneForCurrentUser(user.sub, dto.code, dto.accessToken, dto.phoneToken);
    return this.withRefreshDelivery(req, res, r);
  }
}
