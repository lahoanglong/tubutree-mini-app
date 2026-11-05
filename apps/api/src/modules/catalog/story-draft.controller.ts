import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORY_NOTE_MAX } from '../ai-advisor/story-draft';
import { StoryDraftService } from './story-draft.service';

export class GenerateStoryDraftDto {
  @IsOptional() @IsString() @MaxLength(STORY_NOTE_MAX) note?: string;
}

/**
 * AI soạn bản nháp kịch bản câu chuyện cho Story Studio. Chỉ ADMIN; không lưu gì: admin xem trước rồi tự bấm Lưu.
 * Mỗi lượt có thể gọi AI trả phí nên giới hạn tốc độ riêng, chặt hơn mức chung.
 */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/products/:id/story-config')
export class StoryDraftController {
  constructor(private readonly svc: StoryDraftService) {}

  @Post('generate')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  generate(@Param('id') id: string, @Body() dto: GenerateStoryDraftDto) {
    return this.svc.generate(id, dto.note);
  }
}
