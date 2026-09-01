import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ZnsClient } from '../integrations/zns/zns.client';
import { ZaloOaTokenService } from '../integrations/zns/zalo-oa-token.service';
import { ZaloOaTokenCron } from '../integrations/zns/zalo-oa-token.cron';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ZnsClient, ZaloOaTokenService, ZaloOaTokenCron],
  // ZaloOaTokenService cũng cần cho ZaloOaMessageClient (module zalo-oa, CSKH quick-reply/auto-reply).
  exports: [NotificationsService, ZaloOaTokenService],
})
export class NotificationsModule {}
