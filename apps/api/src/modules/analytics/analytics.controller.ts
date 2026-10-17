import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { normalizeEntryToken } from '../../common/attribution';
import { IngestEventsDto } from './dto/ingest-events.dto';

@Controller('events')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsEventsService) {}

  // Không tự đặt getTracker: AppThrottlerGuard toàn cục đã đếm theo userId (JWT) hoặc IP. Khoá theo
  // x-device-id trước đây cho phép đổi header mỗi request để né giới hạn.
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
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
        entrySource: normalizeEntryToken(e.entrySource),
        campaign: normalizeEntryToken(e.campaign),
        notificationId: e.notificationId ?? null,
        refCode: e.refCode ?? null,
        storefrontSlug: e.storefrontSlug ?? null,
        props: e.props ?? {},
      });
    }
    return { accepted: dto.events.length };
  }
}
