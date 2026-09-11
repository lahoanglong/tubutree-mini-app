import { Body, Controller, Get, Post, HttpCode, HttpStatus, Req, Res, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import type { Request, Response } from 'express';
import type { JwtPayload, LoginResponse } from '@tubutree/shared-types';
import type { Env } from '../../config/env.validation';
import { Public } from '../../common/decorators/public.decorator';
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

class GuestLoginDto {
  @IsString() @IsNotEmpty() deviceId!: string;
  @IsString() @IsOptional() referralCode?: string;
}

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
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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
      if (wantsCookieAuth(req)) clearRefreshCookies(res);
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
}
