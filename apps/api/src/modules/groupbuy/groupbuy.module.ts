import { Module } from '@nestjs/common';
import { GroupBuyController } from './groupbuy.controller';
import { GroupBuyService } from './groupbuy.service';
import { GroupBuyCron } from './groupbuy.cron';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [GroupBuyController],
  providers: [GroupBuyService, GroupBuyCron],
  exports: [GroupBuyService],
})
export class GroupBuyModule {}
