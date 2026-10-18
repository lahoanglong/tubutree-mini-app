import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteCustomerController } from './waste-customer.controller';
import { WasteMeService } from './waste-me.service';
import { WastePreviewService } from './waste-preview.service';
import { WasteRequestsService } from './waste-requests.service';

@Module({ imports: [WasteCoreModule], controllers: [WasteCustomerController], providers: [WasteRequestsService, WasteCatalogueService, WasteMeService, WastePreviewService] })
export class WasteCustomerModule {}
