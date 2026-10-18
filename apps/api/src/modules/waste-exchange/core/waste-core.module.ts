import { Module } from '@nestjs/common';
import { WasteConfigService } from './waste-config.service';
import { WasteEventsService } from './waste-events';
import { WasteNotifierService } from './waste-notifier.service';

@Module({
  providers: [WasteConfigService, WasteEventsService, WasteNotifierService],
  exports: [WasteConfigService, WasteEventsService, WasteNotifierService],
})
export class WasteCoreModule {}
