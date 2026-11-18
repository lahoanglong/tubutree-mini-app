import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsAdminController } from './analytics-admin.controller';
import { LaunchWatchService } from './launch-watch.service';
import { PurchaseFunnelService } from './purchase-funnel.service';
import { WebhookRejectCounterService } from './webhook-reject-counter.service';
import { VitalsAdminController } from './vitals/vitals-admin.controller';
import { VitalsIngestGate } from './vitals/vitals-ingest.gate';
import { VitalsSummaryService } from './vitals/vitals-summary.service';

@Global()
@Module({
  controllers: [AnalyticsController, AnalyticsAdminController, VitalsAdminController],
  providers: [
    AnalyticsEventsService,
    AnalyticsAggregationService,
    LaunchWatchService,
    PurchaseFunnelService,
    WebhookRejectCounterService,
    VitalsIngestGate,
    VitalsSummaryService,
  ],
  exports: [AnalyticsEventsService, WebhookRejectCounterService, PurchaseFunnelService],
})
export class AnalyticsModule {}
