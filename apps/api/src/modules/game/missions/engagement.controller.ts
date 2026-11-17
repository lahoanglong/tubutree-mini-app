import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import type { BadgesResponse, DailyMissionClaimResponse, DailyMissionsResponse } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DailyMissionsService } from './daily-missions.service';
import { BadgesService } from './badges.service';

export class DailyClaimDto {
  /** Bắt buộc: thưởng tính chung trần thiết bị của game mini, không có mã thiết bị thì không có thưởng. */
  @IsString()
  @Length(8, 128)
  deviceId!: string;
}

/** Nhiệm vụ hằng ngày và huy hiệu của khách đã đăng nhập. Hai cờ tắt: GET trả `enabled: false`, nhận thưởng trả 404 DAILY_DISABLED. */
@Controller('game')
export class EngagementController {
  constructor(
    private readonly daily: DailyMissionsService,
    private readonly badges: BadgesService,
  ) {}

  @Header('Cache-Control', 'private, no-store')
  @Get('daily')
  today(@CurrentUser('sub') userId: string): Promise<DailyMissionsResponse> {
    return this.daily.today(userId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post('daily/:id/claim')
  claim(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: DailyClaimDto): Promise<DailyMissionClaimResponse> {
    return this.daily.claim(userId, id, dto.deviceId);
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('badges')
  list(@CurrentUser('sub') userId: string): Promise<BadgesResponse> {
    return this.badges.list(userId);
  }
}
