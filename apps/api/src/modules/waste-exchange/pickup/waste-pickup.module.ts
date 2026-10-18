import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteExpiryCron } from './waste-expiry.cron';
import { WastePickupHooks } from './waste-pickup-hooks.service';

@Module({
  imports: [WasteCoreModule],
  providers: [WastePickupHooks, WasteExpiryCron],
  exports: [WastePickupHooks],
})
export class WastePickupModule {}
