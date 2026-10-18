import { Module } from '@nestjs/common';
import { DealerService } from './dealer.service';
import { DealerController } from './dealer.controller';
import { DealerAdminController, DealerOrderAdminController, DealerCreditAdminController } from './dealer-admin.controller';
import { DealerAccountsAdminController, DealerTierAdminController } from './dealer-accounts-admin.controller';
import { DealerAccountsAdminService } from './dealer-accounts-admin.service';
import { DealerCron } from './dealer.cron';
import { DealerBackorderService } from './dealer-backorder.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';

@Module({
  imports: [NotificationsModule, PancakeModule],
  controllers: [
    DealerController,
    DealerAdminController,
    DealerOrderAdminController,
    DealerCreditAdminController,
    DealerAccountsAdminController,
    DealerTierAdminController,
  ],
  providers: [DealerService, DealerCron, DealerBackorderService, DealerAccountsAdminService],
  exports: [DealerService],
})
export class DealerModule {}
