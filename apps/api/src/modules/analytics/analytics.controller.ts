import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { IngestEventsDto } from './dto/ingest-events.dto';

@Controller('events')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsEventsService) {}

  // Track theo X-Device-Id thay vì IP — Wi-Fi cửa hàng/CGNAT dùng chung IP không được lấy hết
  // hạn mức của nhau ở endpoint này (A7-02). getTracker được ĐỌC bởi guard APP_GUARD toàn cục có
  // sẵn (ThrottlerGuard trong app.module.ts) — không cần một guard riêng chồng lên (guard riêng
  // trước đây chạy SONG SONG với guard IP toàn cục chứ không thay thế, nên throttle theo IP vẫn
  // áp dụng — phát hiện ở review cuối).
  @Throttle({
    default: {
      ttl: 60_000,
      limit: 200,
      getTracker: (req: Record<string, any>) => {
        const deviceId = req.headers?.['x-device-id'];
        if (typeof deviceId === 'string' && deviceId.length > 0) return deviceId;
        return req.user?.sub ?? req.ip ?? 'unknown';
      },
    },
  })
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
