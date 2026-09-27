import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';

@Global()
@Module({
  providers: [AnalyticsEventsService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsModule {}
