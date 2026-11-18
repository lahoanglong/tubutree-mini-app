import { Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { GameAlbumService } from './album.service';
import type { AlbumResponse, AlbumReviewStartResponse, AlbumReviewSubmitResponse } from './album.types';

export class AlbumReviewSubmitDto {
  /** Mã ván ôn (`roundId` của lúc bắt đầu). */
  @IsString()
  @MaxLength(40)
  roundId!: string;

  /** Chỉ số lựa chọn mỗi câu hoặc null; hình dạng kiểm khi chấm. */
  @IsArray()
  @ArrayMaxSize(20)
  answers!: unknown[];
}

/**
 * Sổ tay Xanh. Route công khai ở tầng guard để cờ tắt trả 404 cho MỌI người (không lộ route có thật); cờ bật thì service đòi đăng nhập (401).
 */
@Controller('game/album')
export class GameAlbumController {
  constructor(private readonly album: GameAlbumService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @Get()
  get(@Query('summary') summary?: string, @CurrentUser('sub') userId?: string): Promise<AlbumResponse> {
    return this.album.album(userId ?? null, { summary: summary === '1' });
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post('review/start')
  start(@CurrentUser('sub') userId?: string): Promise<AlbumReviewStartResponse> {
    return this.album.startReview(userId ?? null);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Post('review/submit')
  submit(@Body() dto: AlbumReviewSubmitDto, @CurrentUser('sub') userId?: string): Promise<AlbumReviewSubmitResponse> {
    return this.album.submitReview(userId ?? null, dto);
  }
}
