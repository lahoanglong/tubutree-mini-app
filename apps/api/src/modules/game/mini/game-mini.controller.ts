import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { MiniStartResponse, MiniSubmitResponse, MiniTodayResponse } from '@tubutree/shared-types';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { GameMiniService } from './game-mini.service';

export class MiniSubmitDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  roundId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  token?: string | null;

  /** Hình dạng theo game do máy chủ kiểm khi chấm (`parseAnswers`); ở đây chỉ chặn cỡ. */
  @IsArray()
  @ArrayMaxSize(20)
  answers!: unknown[];

  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string | null;
}

/**
 * Lượt chơi có thưởng của 5 game mini. Công khai (khách chưa đăng nhập chơi thử, không thưởng); có phiên thì biết khách để giữ ván
 * và cộng thưởng. Cờ `game.mini.enabled` hoặc cờ của game tắt: mọi route trả 404.
 */
@Controller('game/mini')
export class GameMiniController {
  constructor(private readonly mini: GameMiniService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @Get('today')
  today(@CurrentUser('sub') userId?: string): Promise<MiniTodayResponse> {
    return this.mini.today(userId ?? null);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post(':game/start')
  start(@Param('game') game: string, @CurrentUser('sub') userId?: string): Promise<MiniStartResponse> {
    return this.mini.start(userId ?? null, game);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post(':game/submit')
  submit(@Param('game') game: string, @Body() dto: MiniSubmitDto, @CurrentUser('sub') userId?: string): Promise<MiniSubmitResponse> {
    return this.mini.submit(userId ?? null, game, dto);
  }
}
