import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORY_ASSETS_MAX_IMAGES, StoryAssetsService } from './story-assets.service';

export class ExtractStoryAssetsDto {
  @IsOptional() @IsString() @MaxLength(2048) pageUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(STORY_ASSETS_MAX_IMAGES) @IsString({ each: true }) @MaxLength(2048, { each: true }) imageUrls?: string[];
}

/** Gợi ý ảnh và bản tách nền cho Story Studio. Chỉ ADMIN; không lưu gì (xem StoryAssetsService). */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/products/:id/story-assets')
export class StoryAssetsController {
  constructor(private readonly svc: StoryAssetsService) {}

  @Post('extract')
  extract(@Param('id') id: string, @Body() dto: ExtractStoryAssetsDto) {
    return this.svc.extract(id, dto);
  }
}
