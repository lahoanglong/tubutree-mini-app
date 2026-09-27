import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { IngestEventsDto } from './dto/ingest-events.dto';
import { DeviceThrottlerGuard } from './device-throttler.guard';

@Controller('events')
@UseGuards(DeviceThrottlerGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsEventsService) {}

  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  @Post()
  async ingest(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: IngestEventsDto,
    @Headers('x-device-id') deviceId?: string,
  ): Promise<{ accepted: number }> {
    for (const e of dto.events) {
      await this.analytics.recordBestEffort({
        eventId: e.eventId,
        eventName: e.eventName,
        occurredAt: new Date(e.occurredAt),
        userId: user?.sub ?? null,
        anonymousId: e.anonymousId ?? deviceId ?? null,
        sessionId: e.sessionId ?? null,
        platform: e.platform,
        appVersion: e.appVersion ?? null,
        entrySource: e.entrySource ?? null,
        notificationId: e.notificationId ?? null,
        refCode: e.refCode ?? null,
        storefrontSlug: e.storefrontSlug ?? null,
        props: e.props ?? {},
      });
    }
    return { accepted: dto.events.length };
  }
}
