import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MINI_GAME_IDS, type MiniGameId } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { PaginationQuery } from '../../common/pagination';
import { GameMiniAdminService, MINI_EXPLANATION_MAX } from '../game/mini/game-mini-admin.service';

const queryBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class MiniContentListQueryDto extends PaginationQuery {
  @IsOptional() @IsIn(MINI_GAME_IDS) game?: MiniGameId;
  @IsOptional() @Transform(queryBool) @IsBoolean() active?: boolean;
}

export class MiniContentCreateDto {
  @IsIn(MINI_GAME_IDS) game!: MiniGameId;
  /** Hình dạng theo game, máy chủ kiểm bằng luật của game đó. */
  @IsObject() payload!: Record<string, unknown>;
  @IsString() @MaxLength(MINI_EXPLANATION_MAX + 50) explanation!: string;
  @IsString() @MaxLength(600) sourceUrl!: string;
  @IsOptional() @IsString() @MaxLength(30) sourceCheckedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) productSlug?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class MiniContentUpdateDto {
  @OptionalNotNull() @IsObject() payload?: Record<string, unknown>;
  @OptionalNotNull() @IsString() @MaxLength(MINI_EXPLANATION_MAX + 50) explanation?: string;
  @OptionalNotNull() @IsString() @MaxLength(600) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(30) sourceCheckedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) productSlug?: string | null;
  @OptionalNotNull() @IsBoolean() active?: boolean;
}

export class MiniStatsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) days?: number;
}

/**
 * Nội dung 5 game mini (bảng game_content_items): xem, thêm, sửa, bật/tắt từng mục, bảng số. Không xoá: ván đã phát phải chấm được
 * mục cũ. Mỗi mục bắt buộc link nguồn https.
 */
@ApiTags('admin-engagement')
@Roles('ADMIN')
@Controller('admin/game-mini')
export class AdminGameMiniController {
  constructor(private readonly mini: GameMiniAdminService) {}

  @Get('items')
  list(@Query() q: MiniContentListQueryDto) {
    return this.mini.list({ game: q.game, active: q.active, page: q.page, limit: q.limit });
  }

  @Post('items')
  create(@Body() dto: MiniContentCreateDto) {
    return this.mini.create(dto);
  }

  @Patch('items/:id')
  update(@Param('id') id: string, @Body() dto: MiniContentUpdateDto) {
    return this.mini.update(id, dto);
  }

  @Get('stats')
  stats(@Query() q: MiniStatsQueryDto) {
    return this.mini.stats(q.days ?? 14);
  }
}
