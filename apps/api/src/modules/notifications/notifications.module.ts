import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ZnsClient } from '../integrations/zns/zns.client';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ZnsClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}
