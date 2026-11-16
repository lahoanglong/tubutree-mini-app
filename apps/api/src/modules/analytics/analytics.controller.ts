import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RECYCLE_FUNNEL_STEPS, type JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { normalizeEntryToken } from '../../common/attribution';
import { IngestEventsDto } from './dto/ingest-events.dto';
import { hashDeviceId } from '../auth/device-id';

const RECYCLE_LANE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Phễu Đổi rác chỉ có nghĩa khi `props.step`/`surface`/`lane` đúng khuôn. Sự kiện sai khuôn bị bỏ riêng lẻ (không trả 400) để một
 * sự kiện hỏng không làm rớt cả lô 50 sự kiện khác; `surface` phải trùng `platform` để không bơm số liệu chéo nền tảng.
 */
export function isValidRecycleFunnelEvent(e: { eventName: string; platform: string; props?: Record<string, unknown> }): boolean {
  if (e.eventName !== 'recycle_funnel_step') return true;
  const p = e.props;
  if (!p) return false;
  if (typeof p.step !== 'string' || !(RECYCLE_FUNNEL_STEPS as readonly string[]).includes(p.step)) return false;
  if (p.surface !== e.platform) return false;
  if (p.lane !== undefined && (typeof p.lane !== 'string' || !RECYCLE_LANE_PATTERN.test(p.lane))) return false;
  return true;
}

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
    // deviceId thô là khoá đăng nhập tài khoản khách: bảng sự kiện (xem được ở báo cáo) chỉ giữ bản băm.
    const anonymousFromDevice = deviceId ? hashDeviceId(deviceId).slice(0, 32) : null;
    const events = dto.events.filter(isValidRecycleFunnelEvent);
    await this.analytics.recordManyBestEffort(
      events.map((e) => ({
        eventId: e.eventId,
        eventName: e.eventName,
        occurredAt: new Date(e.occurredAt),
        userId: user?.sub ?? null,
        anonymousId: e.anonymousId ?? anonymousFromDevice,
        sessionId: e.sessionId ?? null,
        platform: e.platform,
        appVersion: e.appVersion ?? null,
        entrySource: normalizeEntryToken(e.entrySource),
        campaign: normalizeEntryToken(e.campaign),
        notificationId: e.notificationId ?? null,
        refCode: e.refCode ?? null,
        storefrontSlug: e.storefrontSlug ?? null,
        props: e.props ?? {},
      })),
    );
    return { accepted: events.length };
  }
}
