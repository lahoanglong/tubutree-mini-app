import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsAdminController } from './analytics-admin.controller';
import { LaunchWatchService } from './launch-watch.service';
import { WebhookRejectCounterService } from './webhook-reject-counter.service';

@Global()
@Module({
  controllers: [AnalyticsController, AnalyticsAdminController],
  providers: [AnalyticsEventsService, AnalyticsAggregationService, LaunchWatchService, WebhookRejectCounterService],
  exports: [AnalyticsEventsService, WebhookRejectCounterService],
})
export class AnalyticsModule {}
