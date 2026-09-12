import { Module } from '@nestjs/common';
import { DealerService } from './dealer.service';
import { DealerController } from './dealer.controller';
import { DealerCron } from './dealer.cron';
import { DealerBackorderService } from './dealer-backorder.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';

@Module({
  imports: [NotificationsModule, PancakeModule],
  controllers: [DealerController],
  providers: [DealerService, DealerCron, DealerBackorderService],
  exports: [DealerService],
})
export class DealerModule {}
