import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { notifyAdmins } from '../../../common/notify-admins';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MSS_SHARED_STORE, type MssSharedStore } from './mss-circuit';
import { MssFlagsService } from './mss-flags';
import { MssClient, MssRequestError } from './mss.client';
import { MssOrderEventDispatcher } from './mss-order-event.dispatch';
import { MssOrderEventFallback } from './mss-order-event.fallback';
import {
  MSS_CLAIM_STALE_MS,
  MSS_FALLBACK_STATUSES,
  MSS_RESULT_STUCK_GRACE_MS,
  MSS_UNAVAILABLE_GIVE_UP_MS,
  nextRetryAt,
  resultStatusOf,
  type MssOutboxStatus,
  type MssResultStatus,
} from './mss-order-event-types';

const FINAL_MSS_STATUSES: ReadonlySet<string> = new Set<MssResultStatus>(['sent', 'skipped', 'failed', 'unknown']);
const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** Báo Ops tối đa một lần mỗi giờ cho mỗi loại lỗi cấu hình (401 sai khoá, 409 thân khác). */
const ALERT_EVERY_MS = 60 * 60_000;
const ERROR_MAX = 300;

interface ClaimedRow {
  id: string;
  eventId: string;
  orderId: string;
  orderCode: string;
  eventType: string;
  body: string;
  attempts: number;
  occurredAt: Date;
  expiresAt: Date;
}

/** Phản hồi `POST /order-events` (202/200) và `GET /order-events/{id}` (hợp đồng mục 3.4, 4.3). */
interface MssEventAck {
  event_id?: unknown;
  status?: unknown;
  reason?: unknown;
  duplicate?: unknown;
}

export type MssDeliverOutcome = 'not_found' | 'not_claimable' | MssOutboxStatus;
export type MssApplyOutcome = 'applied' | 'noop' | 'unknown_event' | 'mismatch';

export function mssReasonOf(raw: unknown): string | null {
  return typeof raw === 'string' && REASON_RE.test(raw) ? raw : null;
}

/**
 * Gửi một sự kiện outbox sang MSS và ghi kết quả. Mọi chuyển trạng thái là UPDATE có điều kiện trên trạng thái hiện tại, nên worker,
 * cron quét bù, callback và đối soát chạy chồng nhau chỉ một bên đổi được dòng; bên thua không làm gì thêm.
 */
@Injectable()
export class MssOrderEventSender {
  private readonly logger = new Logger(MssOrderEventSender.name);
  private readonly alertedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MssClient,
    private readonly flags: MssFlagsService,
    private readonly dispatcher: MssOrderEventDispatcher,
    private readonly fallback: MssOrderEventFallback,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() @Inject(MSS_SHARED_STORE) private readonly store?: MssSharedStore,
  ) {}

  /**
   * Nhận dòng (PENDING đã tới hạn, hoặc SENDING bị bỏ dở quá 2 phút) rồi gửi đúng `body` đã lưu với chữ ký mới. Không ném lỗi MSS.
   * `not_found`: dòng chưa hiện (transaction ghi chưa commit hoặc đã rollback); `not_claimable`: người khác đang giữ hoặc chưa tới hạn.
   */
  async deliver(eventId: string): Promise<MssDeliverOutcome> {
    // Giờ của API, không phải now() của Postgres: nextAttemptAt/claimedAt đều ghi bằng giờ API, lệch đồng hồ hai máy làm dòng mới
    // "chưa tới hạn" và job đầu bị bỏ, phải chờ cron quét bù.
    const now = new Date();
    const staleBefore = new Date(now.getTime() - MSS_CLAIM_STALE_MS);
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "mss_order_event_outbox"
      SET "status" = 'SENDING', "claimedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
      WHERE "eventId" = ${eventId}
        AND (("status" = 'PENDING' AND "nextAttemptAt" <= ${now})
          OR ("status" = 'SENDING' AND "claimedAt" < ${staleBefore}))
      RETURNING "id", "eventId", "orderId", "orderCode", "eventType", "body", "attempts", "occurredAt", "expiresAt"`;
    const row = rows[0];
    if (!row) {
      const exists = await this.prisma.mssOrderEventOutbox.findUnique({ where: { eventId }, select: { id: true } });
      return exists ? 'not_claimable' : 'not_found';
    }
    if (Date.now() >= row.expiresAt.getTime()) return this.finishClaimed(row, 'EXPIRED', 'ttl');
    if (!(await this.flags.isEnabled('orderEvents'))) return this.finishClaimed(row, 'CANCELLED', 'disabled');
    // Thân đã lưu ghi consent = true lúc ghi; khách có thể tắt sau đó (cài đặt, hay MSS báo opted_out ở đơn khác) trong lúc dòng chờ thử lại.
    const consent = await this.prisma.order.findUnique({ where: { id: row.orderId }, select: { orderZaloConsent: true, user: { select: { notifyOrderZalo: true } } } });
    if (consent?.orderZaloConsent !== true || consent.user.notifyOrderZalo !== true) return this.finishClaimed(row, 'CANCELLED', 'consent_withdrawn');

    try {
      const res = await this.client.request<MssEventAck>('POST', '/order-events', { body: row.body, eventId: row.eventId, op: 'POST /order-events' });
      const status = typeof res.data?.status === 'string' ? res.data.status : null;
      if (status && FINAL_MSS_STATUSES.has(status)) {
        // 200 duplicate: MSS đã nhận lượt trước (phản hồi bị mất) và đã có kết quả cuối.
        return this.finishClaimed(row, resultStatusOf(status as MssResultStatus), mssReasonOf(res.data?.reason), { lastHttpStatus: res.status, deliveredAt: new Date() });
      }
      const moved = await this.prisma.mssOrderEventOutbox.updateMany({
        where: { id: row.id, status: 'SENDING' },
        data: { status: 'DELIVERED', deliveredAt: new Date(), lastHttpStatus: res.status, lastError: null, claimedAt: null },
      });
      if (moved.count === 1) this.logger.log(`mss_order_event_delivered ${row.eventType} order=${row.orderCode} event=${row.eventId} http=${res.status} attempt=${row.attempts}`);
      return 'DELIVERED';
    } catch (err) {
      if (!(err instanceof MssRequestError)) {
        this.logger.error(`Gửi MSS sự kiện ${row.eventId} lỗi ngoài dự kiến: ${err instanceof Error ? err.message : String(err)}`);
        return this.retryLater(row, null, `internal: ${err instanceof Error ? err.message : String(err)}`, undefined);
      }
      return this.onRequestError(row, err);
    }
  }

  private async onRequestError(row: ClaimedRow, err: MssRequestError): Promise<MssDeliverOutcome> {
    const http = err.status ?? null;
    const code = err.details.code;
    if (err.kind === 'unauthorized') {
      await this.alertOnce('unauthorized', 'MSS từ chối chữ ký của Tubu (401 unauthorized) khi gửi tin đơn hàng. Kiểm MSS_KEY_ID và MSS_OUTBOUND_SECRET.');
      return this.finishClaimed(row, 'DEAD', 'unauthorized', { lastHttpStatus: http, lastError: err.message });
    }
    if (err.kind === 'client_error') {
      if (http === 409) {
        await this.alertOnce('event_id_reused', `MSS báo trùng event_id nhưng khác thân (409) cho đơn ${row.orderCode}. Đây là lỗi lập trình phía Tubu.`);
        return this.finishClaimed(row, 'DEAD', 'event_id_reused', { lastHttpStatus: http, lastError: err.message });
      }
      return this.finishClaimed(row, 'DEAD', mssReasonOf(code) ?? `http_${http ?? 'unknown'}`, { lastHttpStatus: http, lastError: err.message });
    }
    const unavailable = err.kind === 'unavailable' || err.kind === 'circuit_open';
    if (unavailable && Date.now() - row.occurredAt.getTime() >= MSS_UNAVAILABLE_GIVE_UP_MS) {
      return this.finishClaimed(row, 'EXPIRED', 'mss_unavailable', { lastHttpStatus: http, lastError: err.message });
    }
    return this.retryLater(row, http, `${err.kind}${code ? ` (${code})` : ''}: ${err.message}`, err.details.retryAfterSec);
  }

  private async retryLater(row: ClaimedRow, http: number | null, error: string, retryAfterSec: number | undefined): Promise<MssDeliverOutcome> {
    const next = nextRetryAt(row.attempts, Date.now(), retryAfterSec);
    if (!next || next.getTime() >= row.expiresAt.getTime()) {
      return this.finishClaimed(row, 'EXPIRED', next ? 'ttl' : 'retries_exhausted', { lastHttpStatus: http, lastError: error });
    }
    const moved = await this.prisma.mssOrderEventOutbox.updateMany({
      where: { id: row.id, status: 'SENDING' },
      data: { status: 'PENDING', nextAttemptAt: next, claimedAt: null, lastHttpStatus: http, lastError: error.slice(0, ERROR_MAX) },
    });
    if (moved.count === 1) this.dispatcher.enqueue(row.eventId, row.attempts, next.getTime() - Date.now());
    return 'PENDING';
  }

  private async finishClaimed(
    row: ClaimedRow,
    status: MssOutboxStatus,
    reason: string | null,
    extra: { lastHttpStatus?: number | null; lastError?: string; deliveredAt?: Date } = {},
  ): Promise<MssDeliverOutcome> {
    const won = await this.settle(row.id, row.eventId, row.orderId, ['SENDING'], status, reason, {
      lastHttpStatus: extra.lastHttpStatus ?? null,
      lastError: extra.lastError?.slice(0, ERROR_MAX) ?? null,
      claimedAt: null,
      ...(extra.deliveredAt ? { deliveredAt: extra.deliveredAt } : {}),
    });
    if (won) this.logger.log(`mss_order_event_result ${row.eventType} order=${row.orderCode} event=${row.eventId} status=${status} reason=${reason ?? '-'}`);
    return status;
  }

  /**
   * Kết quả cuối MSS báo về (callback hoặc đối soát), đúng mã đơn + loại sự kiện; callback lặp, đến muộn hay lệch dữ liệu đều không đổi gì.
   * Nhận cả khi dòng còn PENDING/SENDING: MSS chỉ báo kết quả cho sự kiện nó đã nhận, mà phía Tubu có thể chưa biết (POST quá 5 giây bị
   * coi là lỗi rồi xếp thử lại, hoặc callback tới trước câu ghi DELIVERED). Bỏ kết quả lúc đó thì dòng sau này EXPIRED và đường lui gửi
   * thêm ZNS cho tin MSS đã gửi.
   */
  async applyResult(
    eventId: string,
    expect: { orderCode?: string; eventType?: string },
    status: MssResultStatus,
    reason: string | null,
    source: 'callback' | 'reconcile',
  ): Promise<MssApplyOutcome> {
    const row = await this.prisma.mssOrderEventOutbox.findUnique({ where: { eventId }, select: { id: true, orderId: true, orderCode: true, eventType: true } });
    if (!row) return 'unknown_event';
    if ((expect.orderCode && expect.orderCode !== row.orderCode) || (expect.eventType && expect.eventType !== row.eventType)) {
      this.logger.warn(`Kết quả MSS (${source}) cho sự kiện ${eventId} lệch mã đơn hoặc loại: bỏ qua.`);
      return 'mismatch';
    }
    const final = resultStatusOf(status);
    const won = await this.settle(row.id, eventId, row.orderId, ['PENDING', 'SENDING', 'DELIVERED'], final, reason, { claimedAt: null });
    if (!won) return 'noop';
    this.logger.log(`mss_order_event_result ${row.eventType} order=${row.orderCode} event=${eventId} status=${final} reason=${reason ?? '-'} via=${source}`);
    return 'applied';
  }

  /** Đối soát một dòng DELIVERED lâu chưa có callback bằng `GET /order-events/{id}`. */
  async reconcileOne(row: { eventId: string; orderCode: string; eventType: string; expiresAt: Date }): Promise<MssApplyOutcome | 'still_open' | 'requeued' | 'stuck' | 'error'> {
    try {
      const res = await this.client.request<MssEventAck>('GET', `/order-events/${encodeURIComponent(row.eventId)}`, { eventId: row.eventId, op: 'GET /order-events/{id}' });
      const status = typeof res.data?.status === 'string' ? res.data.status : null;
      if (status && FINAL_MSS_STATUSES.has(status)) {
        return this.applyResult(row.eventId, { orderCode: row.orderCode, eventType: row.eventType }, status as MssResultStatus, mssReasonOf(res.data?.reason), 'reconcile');
      }
      if (Date.now() - row.expiresAt.getTime() >= MSS_RESULT_STUCK_GRACE_MS) {
        // MSS giữ quá hạn sống mà không chốt: coi như không rõ (có thể đã gửi), chỉ còn đường lui trong app.
        const r = await this.applyResult(row.eventId, {}, 'unknown', 'stuck', 'reconcile');
        return r === 'applied' ? 'stuck' : r;
      }
      return 'still_open';
    } catch (err) {
      if (err instanceof MssRequestError && err.kind === 'client_error' && err.status === 404) {
        // MSS không có sự kiện (mất dữ liệu phía MSS): còn hạn thì trả về PENDING để cron quét bù gửi lại cùng event_id và thân.
        const expired = Date.now() >= row.expiresAt.getTime();
        const moved = await this.prisma.mssOrderEventOutbox.updateMany({
          where: { eventId: row.eventId, status: 'DELIVERED' },
          data: expired ? { status: 'EXPIRED', resultReason: 'mss_lost', resultAt: new Date() } : { status: 'PENDING', nextAttemptAt: new Date() },
        });
        if (moved.count === 1 && expired) await this.fallback.run(row.eventId);
        return 'requeued';
      }
      this.logger.warn(`Đối soát MSS sự kiện ${row.eventId} lỗi: ${err instanceof Error ? err.message : String(err)}`);
      if (Date.now() - row.expiresAt.getTime() >= MSS_RESULT_STUCK_GRACE_MS) {
        const r = await this.applyResult(row.eventId, {}, 'unknown', 'stuck', 'reconcile');
        return r === 'applied' ? 'stuck' : r;
      }
      return 'error';
    }
  }

  /** Chuyển dòng từ một trong `from` sang trạng thái cuối, rồi chạy hệ quả đúng một lần (bên thắng câu UPDATE). */
  private async settle(
    id: string,
    eventId: string,
    orderId: string,
    from: MssOutboxStatus[],
    status: MssOutboxStatus,
    reason: string | null,
    data: { lastHttpStatus?: number | null; lastError?: string | null; claimedAt?: null; deliveredAt?: Date },
  ): Promise<boolean> {
    const moved = await this.prisma.mssOrderEventOutbox.updateMany({
      where: { id, status: { in: from } },
      data: { ...data, status, resultReason: reason, resultAt: new Date() },
    });
    if (moved.count === 0) return false;
    if (status === 'RESULT_SKIPPED' && reason === 'opted_out') await this.recordOptOut(orderId);
    if (MSS_FALLBACK_STATUSES.includes(status)) await this.fallback.run(eventId);
    return true;
  }

  /** Hợp đồng mục 4.2: khách từ chối nhận tin trên Zalo thì Tubu tắt lựa chọn đã nhớ, các đơn sau không phát nữa. */
  private async recordOptOut(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
    if (!order) return;
    await this.prisma.user.updateMany({
      where: { id: order.userId, notifyOrderZalo: true },
      data: { notifyOrderZalo: false, notifyOrderZaloAt: new Date(), notifyOrderZaloSource: 'mss_opt_out' },
    });
  }

  private async alertOnce(kind: string, summary: string): Promise<void> {
    try {
      const now = Date.now();
      let first: boolean;
      if (this.store) {
        first = await this.store.setIfAbsent(`tubu:mss:order_events:alert:${kind}`, String(now), ALERT_EVERY_MS).catch(() => this.memoryFirst(kind, now));
      } else {
        first = this.memoryFirst(kind, now);
      }
      if (!first) return;
      this.logger.error(summary);
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { template: 'OPS_HEALTH_ALERT', subject: `tin đơn hàng MSS: ${kind}`, data: () => ({ title: 'Tin đơn hàng qua MSS', summary }) },
      );
    } catch (err) {
      this.logger.warn(`Không báo được Ops về lỗi MSS ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private memoryFirst(kind: string, now: number): boolean {
    const at = this.alertedAt.get(kind);
    if (at !== undefined && now - at < ALERT_EVERY_MS) return false;
    this.alertedAt.set(kind, now);
    return true;
  }
}
