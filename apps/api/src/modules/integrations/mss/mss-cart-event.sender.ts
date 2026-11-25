import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { runExclusive } from '../../../common/cron-leader/run-exclusive';
import { markCronSkipped, noteCronError, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MssHealthService } from './mss-health.service';
import { MssClient, MssRequestError } from './mss.client';
import { cartRecoveredRow, type CartRecoveredRowInput } from './mss-cart-event-body';
import {
  cartConsentOf,
  cartPurgeBefore,
  MSS_CART_EVENTS_PATH,
  MSS_CART_LIVE_RESULTS,
  MSS_CART_PURGE_BATCH,
  MSS_CART_RECOVERY_WINDOW_MS,
  MSS_CART_SEND_BATCH,
  mssCartResultOf,
  type MssCartStatus,
} from './mss-cart-event-types';
import { MSS_CLAIM_STALE_MS, nextRetryAt } from './mss-order-event-types';

const ERROR_MAX = 300;
const RECOVERY_BATCH = 100;

export interface MssCartClaimedRow {
  id: string;
  eventId: string;
  type: string;
  userId: string;
  cartId: string;
  cartUpdatedAt: Date;
  cartRemindedAt: Date | null;
  body: string;
  attempts: number;
  expiresAt: Date;
}

interface MssCartAck {
  status?: unknown;
  reason?: unknown;
}

export interface MssCartRunStats {
  expired: number;
  purged: number;
  recovered: number;
  accepted: number;
  skipped: number;
  rejected: number;
  retried: number;
  dead: number;
}

/** `back_off`: MSS bảo chờ (503, 429, cầu dao ngắt, thiếu cấu hình); các dòng còn lại của lượt trả về hàng chờ, không gửi tiếp. */
type DeliverOutcome = MssCartStatus | 'back_off';

/**
 * Gửi sự kiện giỏ sang MSS (`POST /cart-events`) mỗi 5 phút. Cờ tắt hoặc MSS chưa công bố `cart.abandoned_zalo` thì không gửi gì: dòng
 * chờ tự hết hạn. Mỗi lượt cũng dò khách đã mua sau lần nhắc MSS đã nhận (ghi `cart.recovered`) và xoá dòng quá 30 ngày (thân có SĐT).
 */
@Injectable()
export class MssCartEventSender {
  private readonly logger = new Logger(MssCartEventSender.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MssClient,
    private readonly health: MssHealthService,
  ) {}

  @Cron('*/5 * * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async tick(): Promise<void> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return;
    }
    this.running = true;
    try {
      const run = await runExclusive(this.prisma, 'cron:mss.cart_events', () => this.runOnce(new Date()));
      if (!run.acquired) {
        markCronSkipped('LOCKED');
        return;
      }
      const s = run.value;
      if (Object.values(s).some((n) => n > 0)) this.logger.log(`mss_cart_events_run ${JSON.stringify(s)}`);
    } catch (err) {
      this.logger.error(`Gửi sự kiện giỏ MSS lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now: Date): Promise<MssCartRunStats> {
    const stats: MssCartRunStats = { expired: 0, purged: 0, recovered: 0, accepted: 0, skipped: 0, rejected: 0, retried: 0, dead: 0 };
    stats.expired = await this.expireStale(now);
    stats.purged = await this.purge(now);
    if (!(await this.health.assertCapability('cartAbandonedZalo'))) return stats;
    stats.recovered = await this.detectRecoveries(now);
    const rows = await this.claim(now);
    for (let i = 0; i < rows.length; i++) {
      const outcome = await this.deliver(rows[i]!, now);
      if (outcome === 'back_off') {
        stats.retried++;
        await this.release(rows.slice(i + 1));
        break;
      }
      if (outcome === 'ACCEPTED') stats.accepted++;
      else if (outcome === 'SKIPPED') stats.skipped++;
      else if (outcome === 'REJECTED') stats.rejected++;
      else if (outcome === 'PENDING') stats.retried++;
      else if (outcome === 'DEAD') stats.dead++;
      else if (outcome === 'EXPIRED') stats.expired++;
    }
    return stats;
  }

  /** Dòng chờ (hoặc bị bỏ dở quá 2 phút) đã quá hạn gửi: EXPIRED. Chạy cả khi cờ tắt. */
  private async expireStale(now: Date): Promise<number> {
    const staleBefore = new Date(now.getTime() - MSS_CLAIM_STALE_MS);
    const res = await this.prisma.mssCartEvent.updateMany({
      where: { expiresAt: { lte: now }, OR: [{ status: 'PENDING' }, { status: 'SENDING', claimedAt: { lt: staleBefore } }] },
      data: { status: 'EXPIRED', resultReason: 'ttl', claimedAt: null },
    });
    return res.count;
  }

  private async purge(now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "mss_cart_events"
      WHERE "id" IN (
        SELECT "id" FROM "mss_cart_events" WHERE "createdAt" < ${cartPurgeBefore(now)} ORDER BY "createdAt" LIMIT ${MSS_CART_PURGE_BATCH}
      )`;
  }

  /**
   * Lần nhắc MSS đã nhận (đang chờ, đã gửi, có thể đã gửi, hay 2xx không đọc được mã) trong 48 giờ mà khách đã đặt đơn sau lúc bỏ giỏ, giỏ đã
   * trống, hoặc khách thôi đủ điều kiện nhận tin (tắt khuyến mãi hay tin đơn qua Zalo, từ chối qua MSS, bị khoá, xoá tài khoản, mất SĐT): ghi
   * `cart.recovered` (khoá duy nhất `(cartRef, type)` nên mỗi giỏ một lần). MSS huỷ lần nhắc chưa gửi và nhớ mốc này 7 ngày.
   */
  async detectRecoveries(now: Date): Promise<number> {
    const since = new Date(now.getTime() - MSS_CART_RECOVERY_WINDOW_MS);
    const due = await this.prisma.$queryRaw<CartRecoveredRowInput[]>`
      SELECT e."userId", e."cartRef", e."cartId", e."cartUpdatedAt"
        FROM "mss_cart_events" e
       WHERE e."type" = 'cart.abandoned'
         AND e."status" = 'ACCEPTED'
         AND (e."resultStatus" IS NULL OR e."resultStatus" IN (${MSS_CART_LIVE_RESULTS[0]}, ${MSS_CART_LIVE_RESULTS[1]}, ${MSS_CART_LIVE_RESULTS[2]}))
         AND e."cartUpdatedAt" >= ${since}
         AND NOT EXISTS (SELECT 1 FROM "mss_cart_events" r WHERE r."cartRef" = e."cartRef" AND r."type" = 'cart.recovered')
         AND (
           EXISTS (SELECT 1 FROM "orders" o WHERE o."userId" = e."userId" AND o."createdAt" > e."cartUpdatedAt")
           OR NOT EXISTS (SELECT 1 FROM "cart_items" ci WHERE ci."cartId" = e."cartId")
           -- Cùng cổng với cartConsentOf: thiếu một điều kiện là phải huỷ lần nhắc MSS còn giữ.
           OR EXISTS (
             SELECT 1 FROM "users" u
              WHERE u."id" = e."userId"
                AND (u."isBlocked" OR u."phone" IS NULL OR u."notifyOrderZaloSource" = 'mss_opt_out'
                     OR u."notifyOrderZalo" IS NOT TRUE OR u."notifyPromo" IS NOT TRUE)
           )
         )
       ORDER BY e."createdAt" ASC
       LIMIT ${RECOVERY_BATCH}`;
    if (due.length === 0) return 0;
    const data = due.map((d) => cartRecoveredRow(d, now));
    const res = await this.prisma.mssCartEvent.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /** Nhận tối đa 20 dòng tới hạn (hoặc SENDING bị bỏ dở quá 2 phút). SKIP LOCKED: hai lượt chạy chồng không nhận trùng dòng. */
  async claim(now: Date): Promise<MssCartClaimedRow[]> {
    // Giờ của API, không phải now() của Postgres: nextAttemptAt/claimedAt đều ghi bằng giờ API.
    const staleBefore = new Date(now.getTime() - MSS_CLAIM_STALE_MS);
    return this.prisma.$queryRaw<MssCartClaimedRow[]>`
      UPDATE "mss_cart_events"
         SET "status" = 'SENDING', "claimedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
       WHERE "id" IN (
         SELECT "id" FROM "mss_cart_events"
          WHERE ("status" = 'PENDING' AND "nextAttemptAt" <= ${now})
             OR ("status" = 'SENDING' AND "claimedAt" < ${staleBefore})
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${MSS_CART_SEND_BATCH}
          FOR UPDATE SKIP LOCKED)
         AND (("status" = 'PENDING' AND "nextAttemptAt" <= ${now}) OR ("status" = 'SENDING' AND "claimedAt" < ${staleBefore}))
      RETURNING "id", "eventId", "type", "userId", "cartId", "cartUpdatedAt", "cartRemindedAt", "body", "attempts", "expiresAt"`;
  }

  async deliver(row: MssCartClaimedRow, now: Date): Promise<DeliverOutcome> {
    if (now.getTime() >= row.expiresAt.getTime()) return this.finish(row, 'EXPIRED', 'ttl');
    if (row.type === 'cart.abandoned') {
      const skip = await this.recheck(row);
      if (skip) return this.finish(row, 'SKIPPED', skip);
    }
    try {
      const res = await this.client.request<MssCartAck>('POST', MSS_CART_EVENTS_PATH, {
        body: row.body,
        eventId: row.eventId,
        idempotencyKey: row.eventId,
        op: 'POST /cart-events',
      });
      return this.finish(row, 'ACCEPTED', mssCartResultOf(res.data?.reason), { resultStatus: mssCartResultOf(res.data?.status), lastHttpStatus: res.status });
    } catch (err) {
      if (!(err instanceof MssRequestError)) {
        this.logger.error(`Gửi sự kiện giỏ MSS ${row.eventId} lỗi ngoài dự kiến: ${err instanceof Error ? err.message : String(err)}`);
        return this.retryLater(row, null, `internal: ${err instanceof Error ? err.message : String(err)}`, undefined, now);
      }
      return this.onRequestError(row, err, now);
    }
  }

  /**
   * Trước khi gửi `cart.abandoned`: khách đã quay lại giỏ sau lần nhắc trong app, đã đặt đơn sau lúc bỏ giỏ, hay không còn đồng ý (hoặc
   * đổi SĐT) thì không gửi.
   */
  private async recheck(row: MssCartClaimedRow): Promise<'cart_changed' | 'recovered' | 'consent_changed' | null> {
    const cart = await this.prisma.cart.findUnique({ where: { id: row.cartId }, select: { updatedAt: true, items: { select: { id: true }, take: 1 } } });
    if (!cart || cart.items.length === 0) return 'cart_changed';
    if (row.cartRemindedAt && cart.updatedAt.getTime() > row.cartRemindedAt.getTime()) return 'cart_changed';
    const ordered = await this.prisma.order.findFirst({ where: { userId: row.userId, createdAt: { gt: row.cartUpdatedAt } }, select: { id: true } });
    if (ordered) return 'recovered';
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: {
        phone: true,
        phoneVerifiedAt: true,
        isBlocked: true,
        notifyPromo: true,
        notifyPromoAt: true,
        notifyOrderZalo: true,
        notifyOrderZaloAt: true,
        notifyOrderZaloSource: true,
      },
    });
    const consent = user ? cartConsentOf(user, new Date()) : 'no_consent';
    if (typeof consent === 'string') return 'consent_changed';
    if (bodyPhone(row.body) !== consent.phone) return 'consent_changed';
    return null;
  }

  private async onRequestError(row: MssCartClaimedRow, err: MssRequestError, now: Date): Promise<DeliverOutcome> {
    const http = err.status ?? null;
    const code = err.details.code;
    switch (err.kind) {
      case 'not_configured':
        // Biến MSS_* vừa mất giữa lượt: trả cả lượt về hàng chờ, không tính lượt thử.
        await this.release([row]);
        return 'back_off';
      case 'unavailable':
        if (code === 'disabled') {
          // MSS tắt công tắc nhắc giỏ: lần nhắc này bỏ, các dòng còn lại chờ lượt sau (khi đó MSS cũng đã thôi công bố năng lực).
          await this.finish(row, 'SKIPPED', 'mss_off', { lastHttpStatus: http });
          return 'back_off';
        }
        await this.retryLater(row, http, describe(err), err.details.retryAfterSec, now);
        return 'back_off';
      case 'rate_limited':
      case 'circuit_open':
        await this.retryLater(row, http, describe(err), err.details.retryAfterSec, now);
        return 'back_off';
      case 'unauthorized':
      case 'client_error': {
        const reason = err.kind === 'unauthorized' ? 'unauthorized' : http === 409 ? 'event_id_reused' : (mssCartResultOf(code) ?? `http_${http ?? 'unknown'}`);
        // Đếm lỗi vào lượt cron (thẻ Sức khoẻ hệ thống): MSS từ chối thân hay chữ ký là lỗi phía Tubu, không tự hết.
        noteCronError(`MSS từ chối sự kiện giỏ ${row.eventId}: ${reason}`);
        this.logger.warn(`mss_cart_event_rejected event=${row.eventId} http=${http ?? '-'} reason=${reason}`);
        return this.finish(row, 'REJECTED', reason, { lastHttpStatus: http, lastError: err.message });
      }
      default:
        return this.retryLater(row, http, describe(err), err.details.retryAfterSec, now);
    }
  }

  private async retryLater(row: MssCartClaimedRow, http: number | null, error: string, retryAfterSec: number | undefined, now: Date): Promise<DeliverOutcome> {
    const next = nextRetryAt(row.attempts, now.getTime(), retryAfterSec);
    if (!next) return this.finish(row, 'DEAD', 'retries_exhausted', { lastHttpStatus: http, lastError: error });
    if (next.getTime() >= row.expiresAt.getTime()) return this.finish(row, 'EXPIRED', 'ttl', { lastHttpStatus: http, lastError: error });
    await this.prisma.mssCartEvent.updateMany({
      where: { id: row.id, status: 'SENDING' },
      data: { status: 'PENDING', nextAttemptAt: next, claimedAt: null, lastHttpStatus: http, lastError: error.slice(0, ERROR_MAX) },
    });
    return 'PENDING';
  }

  /** Trả dòng đã nhận mà chưa gửi về hàng chờ, không tính lượt thử. */
  private async release(rows: readonly MssCartClaimedRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.mssCartEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'SENDING' },
      data: { status: 'PENDING', claimedAt: null, attempts: { decrement: 1 } },
    });
  }

  private async finish(
    row: MssCartClaimedRow,
    status: MssCartStatus,
    reason: string | null,
    extra: { resultStatus?: string | null; lastHttpStatus?: number | null; lastError?: string } = {},
  ): Promise<MssCartStatus> {
    const moved = await this.prisma.mssCartEvent.updateMany({
      where: { id: row.id, status: 'SENDING' },
      data: {
        status,
        resultReason: reason,
        claimedAt: null,
        ...(extra.resultStatus !== undefined ? { resultStatus: extra.resultStatus } : {}),
        ...(extra.lastHttpStatus !== undefined ? { lastHttpStatus: extra.lastHttpStatus } : {}),
        lastError: extra.lastError?.slice(0, ERROR_MAX) ?? null,
      },
    });
    if (moved.count === 1) {
      this.logger.log(`mss_cart_event_result ${row.type} event=${row.eventId} status=${status} result=${extra.resultStatus ?? '-'} reason=${reason ?? '-'}`);
    }
    return status;
  }
}

function describe(err: MssRequestError): string {
  return `${err.kind}${err.details.code ? ` (${err.details.code})` : ''}: ${err.message}`;
}

/** SĐT đã ghi trong thân lưu (để biết khách đã đổi số sau lúc ghi). */
function bodyPhone(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { customer?: { phone?: unknown } };
    return typeof parsed.customer?.phone === 'string' ? parsed.customer.phone : null;
  } catch {
    return null;
  }
}
