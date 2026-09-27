import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';
import { AnalyticsController } from './analytics.controller';

@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsEventsService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsModule {}
