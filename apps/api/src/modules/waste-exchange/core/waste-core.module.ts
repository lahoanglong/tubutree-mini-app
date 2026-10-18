import { Module } from '@nestjs/common';
import { WasteAccessService } from './waste-access.service';
import { WasteConfigService } from './waste-config.service';
import { WasteEventsService } from './waste-events';
import { WasteNotifierService } from './waste-notifier.service';

@Module({
  providers: [WasteConfigService, WasteEventsService, WasteNotifierService, WasteAccessService],
  exports: [WasteConfigService, WasteEventsService, WasteNotifierService, WasteAccessService],
})
export class WasteCoreModule {}
