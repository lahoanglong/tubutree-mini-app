import { BadRequestException, Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RECYCLE_FUNNEL_STEPS, type JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { normalizeEntryToken } from '../../common/attribution';
import { IngestEventsDto, WebBeaconDto, WebIngestEventsDto, type EventEnvelopeDto } from './dto/ingest-events.dto';
import { hashDeviceId } from '../auth/device-id';
import { checkEventProps } from './event-props';
import { BODY_TOO_COMPLEX_MESSAGE, MAX_BODY_NODES, inspectBody } from '../../common/body-limits';
import { isPlausibleVital, isVitalEventName } from './vitals/vitals-rules';
import { VitalsIngestGate } from './vitals/vitals-ingest.gate';

const RECYCLE_LANE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Sự kiện được ghi: đúng luật phễu Đổi rác, `props` qua danh sách trắng (không khoá lạ, không chuỗi giống SĐT/email) và số đo tốc độ đúng nền
 * tảng, trong khoảng hợp lý.
 */
export function isAcceptedClientEvent(e: { eventName: string; platform: string; props?: Record<string, unknown> }): boolean {
  return isValidRecycleFunnelEvent(e) && checkEventProps(e.eventName, e.props) === 'ok' && isPlausibleVital(e);
}

const uuidOrNull = (v: string | undefined): string | null => (v && UUID_PATTERN.test(v) ? v : null);

/**
 * Trần của khách ẩn danh: bộ đếm toàn cục chạy trước OptionalJwtAuthGuard nên mọi lời gọi web đều đếm theo IP. Một trình duyệt gửi tối đa
 * 12 lô/phút (5 giây một lô) cộng vài beacon lúc ẩn trang; trần cao hơn chỉ để người gửi giả ghi thêm hàng vào bảng sự kiện.
 */
const WEB_EVENTS_PER_MINUTE = 60;
const WEB_BEACONS_PER_MINUTE = 30;

@Controller('events')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsEventsService,
    private readonly vitals: VitalsIngestGate,
  ) {}

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
    const events = await this.vitals.filter(dto.events.filter(isAcceptedClientEvent));
    await this.analytics.recordManyBestEffort(
      events.map((e) => this.toInput(e, user?.sub ?? null, e.anonymousId ?? anonymousFromDevice, e.sessionId ?? null)),
    );
    return { accepted: events.length };
  }

  /**
   * Sự kiện của website, khách chưa đăng nhập cũng gửi được: đây là kênh ra mắt mà phần lớn lượt xem là khách ẩn danh. Có Bearer hợp lệ
   * thì gắn userId; Bearer hết hạn không làm 401 (khách vẫn được đếm theo phiên). Chỉ nhận `platform: 'web'`, mã ẩn danh và mã phiên
   * phải là UUID (máy chủ không nhận chuỗi tự do vào hai cột này).
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: WEB_EVENTS_PER_MINUTE } })
  @Post('web')
  async ingestWeb(@CurrentUser() user: JwtPayload | undefined, @Body() dto: WebIngestEventsDto): Promise<{ accepted: number }> {
    return this.recordWeb(user?.sub ?? null, dto.events);
  }

  /**
   * Bản gửi lúc rời trang (sendBeacon / fetch keepalive): thân form `payload=<json>` để là request "đơn giản" (không preflight CORS, không
   * gửi được Authorization), nên luôn ghi như khách ẩn danh; phiên nối với tài khoản qua các sự kiện khác cùng `sessionId`.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: WEB_BEACONS_PER_MINUTE } })
  @Post('web/beacon')
  @HttpCode(204)
  async ingestWebBeacon(@Body() dto: WebBeaconDto): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(dto.payload);
    } catch {
      throw new BadRequestException('payload không phải JSON');
    }
    // Bộ chặn thân request chỉ thấy một chuỗi trong form: kiểm số nút/độ sâu của JSON bên trong trước khi class-transformer dựng đối tượng
    // (chi phí tăng gần bình phương theo số khoá).
    if (inspectBody(parsed, MAX_BODY_NODES)) throw new BadRequestException(BODY_TOO_COMPLEX_MESSAGE);
    const body = plainToInstance(WebIngestEventsDto, parsed);
    const errors = await validate(body, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) throw new BadRequestException('payload sai khuôn');
    await this.recordWeb(null, body.events);
  }

  private async recordWeb(userId: string | null, events: EventEnvelopeDto[]): Promise<{ accepted: number }> {
    const ok = await this.vitals.filter(events.filter((e) => e.platform === 'web' && isAcceptedClientEvent(e)));
    // Web không gửi appVersion/notificationId/refCode/storefrontSlug: không lưu chuỗi tự do của người gửi ẩn danh vào các cột đó.
    await this.analytics.recordManyBestEffort(
      ok.map((e) => ({
        ...this.toInput(e, userId, uuidOrNull(e.anonymousId), uuidOrNull(e.sessionId)),
        appVersion: null,
        notificationId: null,
        refCode: null,
        storefrontSlug: null,
      })),
    );
    return { accepted: ok.length };
  }

  private toInput(e: EventEnvelopeDto, userId: string | null, anonymousId: string | null, sessionId: string | null) {
    // Số đo tốc độ không gắn với ai: bỏ mọi định danh và nhãn nguồn dù app gửi kèm (Mini App gửi qua hàng đợi chung có JWT và mã phiên).
    if (isVitalEventName(e.eventName)) {
      return {
        eventId: e.eventId,
        eventName: e.eventName,
        occurredAt: new Date(e.occurredAt),
        userId: null,
        anonymousId: null,
        sessionId: null,
        platform: e.platform,
        appVersion: e.appVersion ?? null,
        entrySource: null,
        campaign: null,
        notificationId: null,
        refCode: null,
        storefrontSlug: null,
        props: e.props ?? {},
      };
    }
    return {
      eventId: e.eventId,
      eventName: e.eventName,
      occurredAt: new Date(e.occurredAt),
      userId,
      anonymousId,
      sessionId,
      platform: e.platform,
      appVersion: e.appVersion ?? null,
      entrySource: normalizeEntryToken(e.entrySource),
      campaign: normalizeEntryToken(e.campaign),
      notificationId: e.notificationId ?? null,
      refCode: e.refCode ?? null,
      storefrontSlug: e.storefrontSlug ?? null,
      props: e.props ?? {},
    };
  }
}
