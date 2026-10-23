import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';

@Module({
  controllers: [SupportChatController],
  providers: [SupportChatService],
  exports: [SupportChatService],
})
export class SupportChatModule {}
