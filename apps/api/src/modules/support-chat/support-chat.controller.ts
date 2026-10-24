import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportChatService } from './support-chat.service';

class PageQuery {
  @IsOptional() @IsString() @MaxLength(64) after?: string;
  @IsOptional() @IsString() @MaxLength(64) before?: string;
}

class ReadBody {
  @IsOptional() @IsString() @MaxLength(64) upToId?: string;
}

@Controller('me/support-chat')
export class SupportChatController {
  constructor(private readonly chat: SupportChatService) {}

  @Get()
  thread(@CurrentUser('sub') userId: string) {
    return this.chat.getThread(userId);
  }

  @Get('messages')
  page(@CurrentUser('sub') userId: string, @Query() q: PageQuery) {
    return this.chat.page(userId, q);
  }

  @Post('messages')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  send(@CurrentUser('sub') userId: string, @Body() dto: SendMessageDto) {
    const { source, ...input } = dto;
    return this.chat.send(userId, input, source ?? 'MINIAPP');
  }

  @Post('read')
  read(@CurrentUser('sub') userId: string, @Body() body?: ReadBody) {
    return this.chat.markRead(userId, body?.upToId);
  }

  @Get('summary')
  async summary(@CurrentUser('sub') userId: string) {
    return { unreadCount: await this.chat.unreadCount(userId) };
  }
}
