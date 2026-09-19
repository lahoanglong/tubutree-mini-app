import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { StorefrontQuestService } from './storefront-quest.service';
import { StorefrontReminderService } from './storefront-reminder.service';
import { ComboService } from './combo.service';

@Module({
  imports: [WalletModule],
  controllers: [StorefrontController],
  providers: [StorefrontService, StorefrontQuestService, StorefrontReminderService, ComboService],
  exports: [StorefrontService, ComboService],
})
export class StorefrontModule {}
