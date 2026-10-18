import { Module } from '@nestjs/common';
import { WalletModule } from '../../wallet/wallet.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteAdminGiftsController } from './waste-admin-gifts.controller';
import { WasteDeskGiftsController } from './waste-desk-gifts.controller';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

@Module({
  imports: [WasteCoreModule, WalletModule],
  controllers: [WasteDeskGiftsController, WasteAdminGiftsController],
  providers: [WasteGiftRedemptionsService],
})
export class WasteCatalogModule {}
