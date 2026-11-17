import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../../../common/guards/optional-jwt-auth.guard';
import { MatcherService } from './matcher.service';
import type { MatcherContentResponse, MatcherResultResponse, MatcherStatusResponse } from './matcher.types';

export class MatcherResultDto {
  /** `[{code, value}]` của 3 câu nhu cầu; hình dạng và câu đúng do máy chủ kiểm (`parseMatcherAnswers`, `resolveChain`). */
  @IsArray()
  @ArrayMaxSize(6)
  answers!: unknown[];

  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string | null;
}

/**
 * "Chọn Chuẩn Xanh". Cờ `game.matcher_enabled` tắt: nội dung và kết quả trả 404, `status` trả `{ enabled: false }` (200) để lối vào
 * ẩn mà không phát yêu cầu lỗi trên mỗi trang. Cờ bật mà nội dung chưa bật đủ thì `status` cũng là false.
 */
@Controller('game/matcher')
export class MatcherController {
  constructor(private readonly matcher: MatcherService) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get('status')
  async status(): Promise<MatcherStatusResponse> {
    return { enabled: await this.matcher.ready() };
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=600')
  @Get()
  content(): Promise<MatcherContentResponse> {
    return this.matcher.publicContent();
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post('result')
  result(@Body() dto: MatcherResultDto, @CurrentUser('sub') userId?: string): Promise<MatcherResultResponse> {
    return this.matcher.result(userId ?? null, dto);
  }
}
