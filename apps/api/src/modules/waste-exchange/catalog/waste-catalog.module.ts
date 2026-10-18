import { Module } from '@nestjs/common';
import { WalletModule } from '../../wallet/wallet.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteAdminGiftsController } from './waste-admin-gifts.controller';
import { WasteAdminGiftsService } from './waste-admin-gifts.service';
import { WasteAdminItemsController } from './waste-admin-items.controller';
import { WasteAdminItemsService } from './waste-admin-items.service';
import { WasteAdminPointsController } from './waste-admin-points.controller';
import { WasteAdminPointsService } from './waste-admin-points.service';
import { WasteDeskGiftsController } from './waste-desk-gifts.controller';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

@Module({
  imports: [WasteCoreModule, WalletModule],
  controllers: [WasteDeskGiftsController, WasteAdminGiftsController, WasteAdminItemsController, WasteAdminPointsController],
  providers: [WasteGiftRedemptionsService, WasteAdminGiftsService, WasteAdminItemsService, WasteAdminPointsService],
})
export class WasteCatalogModule {}
