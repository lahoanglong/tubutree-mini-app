import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WastePickupHooks } from './waste-pickup-hooks.service';

@Module({
  imports: [WasteCoreModule],
  providers: [WastePickupHooks],
  exports: [WastePickupHooks],
})
export class WastePickupModule {}
