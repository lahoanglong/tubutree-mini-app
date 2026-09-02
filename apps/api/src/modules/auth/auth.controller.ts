import { Body, Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import type { JwtPayload, LoginResponse } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
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
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('zalo-mini-app')
  @HttpCode(HttpStatus.OK)
  loginZaloMiniApp(@Body() dto: ZaloMiniAppLoginDto): Promise<LoginResponse> {
    return this.auth.loginWithZaloMiniApp(dto.code, dto.accessToken, dto.phoneToken, dto.referralCode);
  }

  /** Đăng nhập khách theo deviceId (fallback khi Zalo login chưa khả dụng). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('guest')
  @HttpCode(HttpStatus.OK)
  loginGuest(@Body() dto: GuestLoginDto): Promise<LoginResponse> {
    return this.auth.loginAsGuest(dto.deviceId, dto.referralCode);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('zalo-oauth')
  @HttpCode(HttpStatus.OK)
  loginZaloOAuth(@Body() dto: ZaloOAuthDto): Promise<LoginResponse> {
    return this.auth.loginWithZaloOAuth(dto.code, dto.codeVerifier, dto.referralCode);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /** GET /api/auth/me — yêu cầu JWT (guard mặc định). */
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    return this.auth.toAuthUser(dbUser);
  }
}
