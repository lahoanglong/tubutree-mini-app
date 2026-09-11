import { Module } from '@nestjs/common';
import { DealerService } from './dealer.service';
import { DealerController } from './dealer.controller';
import { DealerCron } from './dealer.cron';
import { NotificationsModule } from '../notifications/notifications.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';

@Module({
  imports: [NotificationsModule, PancakeModule],
  controllers: [DealerController],
  providers: [DealerService, DealerCron],
  exports: [DealerService],
})
export class DealerModule {}
