import { Body, Controller, Injectable, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiAdvisorService } from './ai-advisor.service';

/**
 * ThrottlerGuard mặc định track theo IP (req.ip) → nhiều user sau NAT/proxy chung sẽ đụng
 * trần chung, còn 1 user đổi IP lại né được giới hạn. Override tracker để track theo userId
 * (đã xác thực qua JwtAuthGuard toàn cục, chạy trước guard này) — đúng với comment "10 lượt/
 * phút/user" ở route chat. Fallback về req.ip khi chưa có user (phòng hờ, không nên xảy ra
 * vì route đã yêu cầu auth).
 */
@Injectable()
class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;
    return user?.sub ?? (req.ip as string | undefined) ?? 'unknown';
  }
}

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
  // UserThrottlerGuard (không phải ThrottlerGuard mặc định) để track theo userId thay vì IP.
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('chat')
  chat(@CurrentUser('sub') userId: string, @Body() dto: ChatDto) {
    return this.advisor.chat(userId, dto.message, dto.history);
  }
}
