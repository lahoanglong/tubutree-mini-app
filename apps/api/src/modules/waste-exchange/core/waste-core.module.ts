import { Module } from '@nestjs/common';
import { WasteAccessService } from './waste-access.service';
import { WasteConfigService } from './waste-config.service';
import { WasteEventsService } from './waste-events';
import { WasteHoldService } from './waste-hold.service';
import { WasteNotifierService } from './waste-notifier.service';

@Module({
  providers: [WasteConfigService, WasteEventsService, WasteNotifierService, WasteAccessService, WasteHoldService],
  exports: [WasteConfigService, WasteEventsService, WasteNotifierService, WasteAccessService, WasteHoldService],
})
export class WasteCoreModule {}
