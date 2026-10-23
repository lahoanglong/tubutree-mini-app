import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';
import { BridgeClient } from './bridge-client';
import { SupportChatForwardProcessor } from './support-chat-forward.processor';

@Module({
  controllers: [SupportChatController],
  providers: [SupportChatService, BridgeClient, SupportChatForwardProcessor],
  exports: [SupportChatService, BridgeClient],
})
export class SupportChatModule {}
