import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsController } from './analytics.controller';

@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsEventsService, AnalyticsAggregationService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsModule {}
