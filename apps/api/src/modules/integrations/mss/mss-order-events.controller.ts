import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MssSignedRoute } from './mss-inbound.guard';
import { isMssOrderEventType, type MssResultStatus } from './mss-order-event-types';
import { MssOrderEventSender, mssReasonOf, type MssApplyOutcome } from './mss-order-event.sender';

const EVENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const RESULT_STATUSES: ReadonlySet<string> = new Set<MssResultStatus>(['sent', 'skipped', 'failed', 'unknown']);

export interface MssEventResultInput {
  eventId: string;
  orderCode: string;
  eventType: string;
  status: MssResultStatus;
  reason: string | null;
}

/** Đọc thân callback (hợp đồng mục 4.2) bằng tay: khoá lạ MSS thêm sau không làm 400, khoá thiếu hay sai kiểu thì 400. */
export function parseMssEventResult(body: unknown): MssEventResultInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.event_id !== 'string' || !EVENT_ID_RE.test(b.event_id)) return null;
  if (typeof b.order_code !== 'string' || b.order_code.length === 0 || b.order_code.length > 32) return null;
  if (!isMssOrderEventType(b.event_type)) return null;
  if (typeof b.status !== 'string' || !RESULT_STATUSES.has(b.status)) return null;
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') return null;
  return { eventId: b.event_id, orderCode: b.order_code, eventType: b.event_type, status: b.status as MssResultStatus, reason: mssReasonOf(b.reason) };
}

/**
 * MSS báo kết quả cuối của một sự kiện đơn (chỉ sau MssInboundGuard: HMAC trên thân thô, lệch giờ tối đa 300 giây). Idempotent theo
 * `event_id`: lặp lại, đến muộn hay không khớp đơn đều trả 200 và không đổi gì, để MSS thôi gửi lại.
 */
@Controller('integrations/mss')
@MssSignedRoute()
@SkipThrottle()
export class MssOrderEventsCallbackController {
  constructor(private readonly sender: MssOrderEventSender) {}

  @Post('order-event-results')
  @HttpCode(200)
  async result(@Body() body: unknown): Promise<{ ok: true; outcome: MssApplyOutcome }> {
    const input = parseMssEventResult(body);
    if (!input) throw new BadRequestException({ error: 'invalid_body', message: 'invalid_body' });
    const outcome = await this.sender.applyResult(input.eventId, { orderCode: input.orderCode, eventType: input.eventType }, input.status, input.reason, 'callback');
    return { ok: true, outcome };
  }
}
