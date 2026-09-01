import { Module } from '@nestjs/common';
import { CskhModule } from '../../cskh/cskh.module';
import { ZaloOaWebhookController } from './zalo-oa-webhook.controller';
import { ZaloOaMessageClient } from './zalo-oa-message.client';
import { ZaloOaEventsProcessor } from './zalo-oa-events.processor';

@Module({
  imports: [CskhModule],
  controllers: [ZaloOaWebhookController],
  providers: [ZaloOaMessageClient, ZaloOaEventsProcessor],
})
export class ZaloOaModule {}
