import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';
import { BridgeClient } from './bridge-client';
import { SupportChatForwardProcessor } from './support-chat-forward.processor';
import { BridgeEventsController } from './bridge-events.controller';
import { BridgeEventsService } from './bridge-events.service';
import { SupportChatAdminController } from './support-chat-admin.controller';
import { SupportChatAdminService } from './support-chat-admin.service';
import { BridgeHealthCron } from './bridge-health.cron';
import { ReplyNotifier } from './reply-notifier';
import { SupportChatNotifyProcessor } from './support-chat-notify.processor';

@Module({
  controllers: [SupportChatController, BridgeEventsController, SupportChatAdminController],
  providers: [SupportChatService, BridgeClient, SupportChatForwardProcessor, BridgeEventsService, SupportChatAdminService, BridgeHealthCron, ReplyNotifier, SupportChatNotifyProcessor],
  exports: [SupportChatService, BridgeClient],
})
export class SupportChatModule {}
