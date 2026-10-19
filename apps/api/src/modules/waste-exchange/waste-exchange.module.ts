import { Module } from '@nestjs/common';
import { WasteCatalogModule } from './catalog/waste-catalog.module';
import { WasteCoreModule } from './core/waste-core.module';
import { WasteCustomerModule } from './customer/waste-customer.module';
import { WastePickupModule } from './pickup/waste-pickup.module';
import { WasteReceivingModule } from './receiving/waste-receiving.module';

@Module({ imports: [WasteCoreModule, WasteCustomerModule, WasteReceivingModule, WasteCatalogModule, WastePickupModule] })
export class WasteExchangeModule {}
