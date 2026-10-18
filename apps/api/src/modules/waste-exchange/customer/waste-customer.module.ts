import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteMeService } from './waste-me.service';
import { WasteRequestsService } from './waste-requests.service';

@Module({ imports: [WasteCoreModule], providers: [WasteRequestsService, WasteCatalogueService, WasteMeService] })
export class WasteCustomerModule {}
