import { Module } from '@nestjs/common';
import { WasteCatalogModule } from '../catalog/waste-catalog.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteExpiryCron } from './waste-expiry.cron';
import { WastePickupHooks } from './waste-pickup-hooks.service';
import { WastePickupSweepCron } from './waste-pickup-sweep.cron';

@Module({
  imports: [WasteCoreModule, WasteCatalogModule],
  providers: [WastePickupHooks, WasteExpiryCron, WastePickupSweepCron],
  exports: [WastePickupHooks],
})
export class WastePickupModule {}
