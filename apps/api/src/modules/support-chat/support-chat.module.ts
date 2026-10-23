import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';
import { BridgeClient } from './bridge-client';
import { SupportChatForwardProcessor } from './support-chat-forward.processor';
import { BridgeEventsController } from './bridge-events.controller';
import { BridgeEventsService } from './bridge-events.service';

@Module({
  controllers: [SupportChatController, BridgeEventsController],
  providers: [SupportChatService, BridgeClient, SupportChatForwardProcessor, BridgeEventsService],
  exports: [SupportChatService, BridgeClient],
})
export class SupportChatModule {}
