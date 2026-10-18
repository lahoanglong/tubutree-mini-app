import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { StorefrontAdminController } from './storefront-admin.controller';
import { StorefrontAdminService } from './storefront-admin.service';
import { StorefrontQuestService } from './storefront-quest.service';
import { StorefrontReminderService } from './storefront-reminder.service';
import { ComboService } from './combo.service';

@Module({
  imports: [WalletModule],
  controllers: [StorefrontController, StorefrontAdminController],
  providers: [StorefrontService, StorefrontAdminService, StorefrontQuestService, StorefrontReminderService, ComboService],
  exports: [StorefrontService, ComboService],
})
export class StorefrontModule {}
