import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiAdvisorService } from './ai-advisor.service';

class ChatTurnDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MaxLength(2000) content!: string;
}

class ChatDto {
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  // Cap rộng chỉ để chặn payload quá khổ — AiAdvisorService tự cắt còn MAX_HISTORY (6) lượt
  // gần nhất trước khi gọi LLM. Cap hẹp hơn số lượt hội thoại thực tế sẽ khiến ValidationPipe
  // (forbidNonWhitelisted) chặn cứng mọi request sau vài lượt chat, hỏng cả tính năng.
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}

@Controller('ai-advisor')
export class AiAdvisorController {
  constructor(private readonly advisor: AiAdvisorService) {}

  // Giới hạn 10 lượt/phút/user — chống lạm dụng làm tốn phí gọi LLM.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat')
  chat(@CurrentUser('sub') userId: string, @Body() dto: ChatDto) {
    return this.advisor.chat(userId, dto.message, dto.history);
  }
}
