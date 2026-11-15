import { Module } from '@nestjs/common';
import { GomdonClientModule } from '../../integrations/gomdon/gomdon-client.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteHomePickupCustomerService } from '../home-pickup/waste-home-pickup-customer.service';
import { WasteHomePickupModule } from '../home-pickup/waste-home-pickup.module';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteCustomerController } from './waste-customer.controller';
import { WasteMeService } from './waste-me.service';
import { WastePreviewService } from './waste-preview.service';
import { WasteRequestsService } from './waste-requests.service';

@Module({
  imports: [WasteCoreModule, WasteHomePickupModule, GomdonClientModule],
  controllers: [WasteCustomerController],
  providers: [WasteRequestsService, WasteCatalogueService, WasteMeService, WastePreviewService, WasteHomePickupCustomerService],
  exports: [WasteRequestsService, WastePreviewService],
})
export class WasteCustomerModule {}
