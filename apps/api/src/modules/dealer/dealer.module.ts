import { Module } from '@nestjs/common';
import { DealerService } from './dealer.service';
import { DealerController } from './dealer.controller';
import { DealerCron } from './dealer.cron';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [DealerController],
  providers: [DealerService, DealerCron],
  exports: [DealerService],
})
export class DealerModule {}
