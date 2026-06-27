import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { StorefrontQuestService } from './storefront-quest.service';

@Module({
  imports: [WalletModule],
  controllers: [StorefrontController],
  providers: [StorefrontService, StorefrontQuestService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
