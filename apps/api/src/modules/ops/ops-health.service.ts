import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { CRON_TZ } from '../../common/cron-tz';
import { formatVnDateTime } from '../../common/vn-time';
import { notifyAdmins } from '../../common/notify-admins';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GomdonClient } from '../integrations/gomdon/gomdon.client';
import { hasGomdonCredentials } from '../integrations/gomdon/gomdon-config';
import { PANCAKE_EVENT_STATUS, pancakeEventRef } from '../integrations/pancake/pancake-webhook-dedupe';
import { GOMDON_EVENT_STATUS } from '../integrations/gomdon/gomdon-webhook.service';
import { GOMDON_STATE } from '../integrations/gomdon/gomdon-status';
import { pancakeUnsyncedWhere, recyclingAttentionWhere } from '../admin/admin-order-filter';
import {
  alertWebhookBody,
  decideAlert,
  OPS_THRESHOLD_KEYS,
  opsProblems,
  type AlertMemory,
  type AlertMessage,
  type CatalogRun,
  type OpsProblem,
  type OpsThresholds,
} from './ops-alerts';
import { DISABLED_EMAIL_STATE, OpsEmailService, type EmailAlertOutcome } from './ops-email.service';
import {
  CATALOG_STATE_KEY,
  recordCatalogRun,
  recordWebhookDelivery,
  WEBHOOK_STATE_KEY,
  type CatalogRunResult,
  type WebhookDeliveryResult,
  type WebhookFailureKind,
} from './ops-state';

/** Phần của BullMQ Queue mà màn sức khoẻ đọc — khai báo cấu trúc để test dựng hàng đợi giả. */
export interface OpsQueue {
  name: string;
  getJobCounts(...types: ('waiting' | 'active' | 'delayed' | 'failed')[]): Promise<Record<string, number>>;
  getFailed(start?: number, end?: number): Promise<{ finishedOn?: number }[]>;
}

export const OPS_QUEUES = Symbol('OPS_QUEUES');
export const OPS_FETCH = Symbol('OPS_FETCH');
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

const ALERT_STATE_KEY = 'alert';
const STUCK_LIST = 20;
/** Số mã đơn đưa vào lời báo động (phần còn lại xem ở màn Sức khoẻ hệ thống). */
const REFS_IN_ALERT = 5;
/** Webhook nhận rồi mà quá chừng này vẫn RECEIVED/PROCESSING = worker không chạy. */
const WEBHOOK_STUCK_MS = 10 * 60_000;
const DAY_MS = 24 * 3_600_000;
/** Job lỗi trong 1 giờ: chỉ xem chừng này job lỗi mới nhất (BullMQ giữ tối đa 1000 job lỗi mỗi hàng đợi). */
const FAILED_SCAN = 200;
const WEBHOOK_TIMEOUT_MS = 5000;

const PANCAKE_STATUSES = Object.values(PANCAKE_EVENT_STATUS);
const GOMDON_STATUSES = Object.values(GOMDON_EVENT_STATUS);

/** Webhook cần người xem: lỗi (mọi tuổi) hoặc nhận rồi mà quá WEBHOOK_STUCK_MS chưa xử lý xong, chưa ai "Đã xử lý". */
export function pancakeOpenEventWhere(now: Date): Prisma.PancakeWebhookEventWhereInput {
  return {
    dismissedAt: null,
    OR: [
      { status: PANCAKE_EVENT_STATUS.FAILED },
      {
        status: { in: [PANCAKE_EVENT_STATUS.RECEIVED, PANCAKE_EVENT_STATUS.PROCESSING] },
        receivedAt: { lt: new Date(now.getTime() - WEBHOOK_STUCK_MS) },
      },
    ],
  };
}

export const GOMDON_OPEN_EVENT_WHERE: Prisma.GomdonWebhookEventWhereInput = { status: GOMDON_EVENT_STATUS.FAILED, dismissedAt: null };

/**
 * Đơn thu gom đã được phép đặt bưu tá (COD, hoặc đã nhận tiền) mà quá `minutes` vẫn chưa có vận đơn Gomdon và chưa
 * rơi vào nhánh tạo tay — Gomdon lỗi/chập kéo dài. Mốc tính từ lúc đặt (COD) hoặc lúc nhận tiền (trả trước).
 */
export function gomdonBacklogWhere(now: Date, minutes: number): Prisma.OrderWhereInput {
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  return {
    hasRecyclingPickup: true,
    status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] },
    gomdonOrderId: null,
    gomdonPartnerCode: null,
    AND: [
      {
        OR: [
          { gomdonStatus: null },
          { gomdonStatus: GOMDON_STATE.CREATING },
          { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT, paymentStatus: 'PAID' },
        ],
      },
      {
        OR: [
          { paymentMethod: 'COD', createdAt: { lt: cutoff } },
          { paymentStatus: 'PAID', paidAt: { lt: cutoff } },
        ],
      },
    ],
  };
}

function refs<T>(rows: T[], ref: (r: T) => string | null): string[] {
  return rows
    .map(ref)
    .filter((r): r is string => Boolean(r))
    .slice(0, REFS_IN_ALERT);
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

/** 4xx là lỗi của chính yêu cầu/hook (hook bị thu hồi 404/410, thân bị từ chối 400, hết quyền 401/403): gửi lại y hệt không bao giờ khá hơn. 408/429 là tạm thời. */
function isPermanentWebhookStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Trạng thái kênh webhook trong ảnh chụp sức khoẻ vận hành, cùng dạng với kênh email (không bao giờ kèm URL hay token). */
export interface WebhookChannelState {
  state: 'DISABLED' | 'READY';
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Loại lỗi gần nhất (null = chưa có lỗi). PERMANENT: hook bị từ chối hẳn, không tự gửi lại liên tục. */
  lastErrorKind: WebhookFailureKind | null;
  lastErrorHint: string | null;
}

export const DISABLED_WEBHOOK_STATE: WebhookChannelState = {
  state: 'DISABLED',
  lastOkAt: null,
  lastErrorAt: null,
  lastError: null,
  lastErrorKind: null,
  lastErrorHint: null,
};

const WEBHOOK_PERMANENT_HINT =
  'Hook báo động bị từ chối hẳn (hook có thể đã bị thu hồi hoặc URL sai) — kiểm tra OPS_ALERT_WEBHOOK_URL. Hệ thống không tự gửi lại liên tục: sửa URL rồi chờ sự cố kế tiếp để thử lại.';

/** Lỗi mạng đôi khi nhắc nguyên URL (kèm token của Slack/Zalo): che trước khi lưu cho màn admin. */
function scrubWebhookUrl(message: string, url: string): string {
  const line = message.split(url).join('[webhook]').replace(/\s+/g, ' ').trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

export type QueueHealth =
  | { ok: true; items: { name: string; waiting: number; active: number; delayed: number; failed: number; failedLastHour: number }[] }
  | { ok: false; error: string };

/**
 * Sức khoẻ vận hành (PLATFORM-5): Pancake (đẩy đơn, webhook, danh mục), Gomdon (webhook, đăng nhập, báo động), các
 * hàng đợi BullMQ và đơn kẹt. Cron 5 phút so với ngưỡng `ops.*` rồi báo admin in-app (thêm webhook ngoài nếu đặt
 * OPS_ALERT_WEBHOOK_URL, thêm email nếu đặt OPS_ALERT_EMAIL_TO + SMTP_*); @Cron chỉ chạy trên instance giữ khoá leader (CronLeaderService).
 */
@Injectable()
export class OpsHealthService {
  private readonly logger = new Logger(OpsHealthService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(OPS_QUEUES) private readonly queues: OpsQueue[],
    @Optional() private readonly sysConfig?: SystemConfigService,
    @Optional() private readonly gomdon?: GomdonClient,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() @Inject(OPS_FETCH) private readonly fetchImpl?: FetchLike,
    @Optional() private readonly email?: OpsEmailService,
  ) {}

  async thresholds(): Promise<OpsThresholds> {
    const entries = await Promise.all(
      (Object.keys(OPS_THRESHOLD_KEYS) as (keyof OpsThresholds)[]).map(async (k) => {
        const { key, fallback } = OPS_THRESHOLD_KEYS[k];
        const v = (await this.sysConfig?.get<number>(key, fallback)) ?? fallback;
        return [k, typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback] as const;
      }),
    );
    return Object.fromEntries(entries) as unknown as OpsThresholds;
  }

  async snapshot(now = new Date()) {
    const t = await this.thresholds();
    const [pancake, gomdon, queues, emailChannel, webhookChannel] = await Promise.all([
      this.pancakeHealth(now, t),
      this.gomdonHealth(now, t),
      this.queueHealth(now),
      this.email?.state() ?? DISABLED_EMAIL_STATE,
      this.webhookChannel(),
    ]);
    const problems = opsProblems(
      {
        pancake: {
          ...pancake,
          stuckRefs: refs(pancake.stuckOrders, (o) => o.code),
          webhookRefs: refs(pancake.failedEvents, (e) => (e.orderRef ? `${e.orderRef} (${e.eventType})` : null)),
          attentionRefs: refs(pancake.attentionOrders, (o) => o.code),
        },
        gomdon: {
          ...gomdon,
          webhookRefs: refs(gomdon.failedEvents, (e) => e.orderRef),
          backlogRefs: refs(gomdon.backlogOrders, (o) => o.code),
          attentionRefs: refs(gomdon.attentionOrders, (o) => o.code),
        },
        queues,
      },
      t,
    );
    return { generatedAt: now.toISOString(), thresholds: t, pancake, gomdon, queues, alertChannels: { email: emailChannel, webhook: webhookChannel }, problems };
  }

  private webhookUrl(): string {
    return String(this.config.get('OPS_ALERT_WEBHOOK_URL', { infer: true }) ?? '').trim();
  }

  private async webhookChannel(): Promise<WebhookChannelState> {
    if (!this.webhookUrl()) return DISABLED_WEBHOOK_STATE;
    try {
      const row = await this.prisma.opsHealthState.findUnique({ where: { key: WEBHOOK_STATE_KEY } });
      const kind = (row?.detail as { kind?: unknown } | null)?.kind;
      const lastErrorKind = kind === 'PERMANENT' || kind === 'TRANSIENT' ? kind : null;
      return {
        state: 'READY',
        lastOkAt: row?.lastOkAt?.toISOString() ?? null,
        lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        lastErrorKind,
        lastErrorHint: lastErrorKind === 'PERMANENT' ? WEBHOOK_PERMANENT_HINT : null,
      };
    } catch (e) {
      this.logger.warn(`Không đọc được trạng thái gửi webhook báo động: ${e instanceof Error ? e.message : String(e)}`);
      return { ...DISABLED_WEBHOOK_STATE, state: 'READY' };
    }
  }

  private async recordWebhook(res: WebhookDeliveryResult, now: Date): Promise<void> {
    try {
      await recordWebhookDelivery(this.prisma, res, now);
    } catch (e) {
      this.logger.warn(`Không ghi được trạng thái gửi webhook báo động: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private pancakeConfigured(): boolean {
    return Boolean(this.config.get('PANCAKE_API_KEY', { infer: true }) && this.config.get('PANCAKE_SHOP_ID', { infer: true }));
  }

  private async pancakeHealth(now: Date, t: OpsThresholds) {
    const since = new Date(now.getTime() - DAY_MS);
    const stuckWhere: Prisma.OrderWhereInput = {
      AND: [pancakeUnsyncedWhere(now), { createdAt: { lt: new Date(now.getTime() - t.unsyncedMinutes * 60_000) } }],
    };
    const [
      lastPush,
      lastByStatus,
      lastProcessed,
      webhookFailed24h,
      webhookFailedOpen,
      webhookStuck,
      failedEvents,
      unsynced,
      stuck,
      stuckOrders,
      attention,
      attentionOrders,
      catalog,
    ] = await Promise.all([
        this.prisma.$queryRaw<{ at: Date | null }[]>`
          SELECT max("pancakeLastAttemptAt") AS "at" FROM "orders"
           WHERE "pancakePushStatus" = 'SYNCED' AND "createdAt" >= ${new Date(now.getTime() - 30 * DAY_MS)}`,
        Promise.all(
          PANCAKE_STATUSES.map((status) =>
            this.prisma.pancakeWebhookEvent.findFirst({ where: { status }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
          ),
        ),
        this.prisma.pancakeWebhookEvent.findFirst({
          where: { status: PANCAKE_EVENT_STATUS.PROCESSED },
          orderBy: { receivedAt: 'desc' },
          select: { processedAt: true, receivedAt: true },
        }),
        this.prisma.pancakeWebhookEvent.count({ where: { status: PANCAKE_EVENT_STATUS.FAILED, receivedAt: { gte: since } } }),
        this.prisma.pancakeWebhookEvent.count({ where: { status: PANCAKE_EVENT_STATUS.FAILED, dismissedAt: null } }),
        this.prisma.pancakeWebhookEvent.count({
          where: {
            dismissedAt: null,
            status: { in: [PANCAKE_EVENT_STATUS.RECEIVED, PANCAKE_EVENT_STATUS.PROCESSING] },
            receivedAt: { lt: new Date(now.getTime() - WEBHOOK_STUCK_MS) },
          },
        }),
        this.prisma.pancakeWebhookEvent.findMany({
          where: pancakeOpenEventWhere(now),
          orderBy: { receivedAt: 'asc' },
          take: STUCK_LIST,
          select: { id: true, eventType: true, status: true, attempts: true, error: true, receivedAt: true, rawPayload: true },
        }),
        this.prisma.order.count({ where: pancakeUnsyncedWhere(now) }),
        this.prisma.order.count({ where: stuckWhere }),
        this.prisma.order.findMany({
          where: stuckWhere,
          orderBy: { createdAt: 'asc' },
          take: STUCK_LIST,
          select: {
            id: true,
            code: true,
            status: true,
            createdAt: true,
            pancakePushStatus: true,
            pancakePushAttempts: true,
            pancakeLastAttemptAt: true,
            pancakeSyncError: true,
          },
        }),
        this.prisma.order.count({ where: { pancakeAttentionAt: { not: null } } }),
        this.prisma.order.findMany({
          where: { pancakeAttentionAt: { not: null } },
          orderBy: { pancakeAttentionAt: 'asc' },
          take: STUCK_LIST,
          select: { id: true, code: true, pancakeAttention: true, pancakeAttentionAt: true },
        }),
        this.prisma.opsHealthState.findUnique({ where: { key: CATALOG_STATE_KEY } }),
      ]);
    const lastWebhook = lastByStatus.reduce<Date | null>((m, r) => (r && (!m || r.receivedAt > m) ? r.receivedAt : m), null);
    const catalogRun: CatalogRun & { detail: unknown } = {
      lastOkAt: catalog?.lastOkAt?.toISOString() ?? null,
      lastErrorAt: catalog?.lastErrorAt?.toISOString() ?? null,
      lastError: catalog?.lastError ?? null,
      detail: catalog?.detail ?? null,
    };
    return {
      configured: this.pancakeConfigured(),
      lastPushOkAt: lastPush[0]?.at?.toISOString() ?? null,
      lastWebhookAt: lastWebhook?.toISOString() ?? null,
      lastWebhookProcessedAt: (lastProcessed?.processedAt ?? lastProcessed?.receivedAt)?.toISOString() ?? null,
      webhookFailed24h,
      webhookFailedOpen,
      webhookStuck,
      failedEvents: failedEvents.map(({ rawPayload, error, ...e }) => ({
        ...e,
        source: 'pancake' as const,
        orderRef: pancakeEventRef(rawPayload),
        error: error?.slice(0, 300) ?? null,
      })),
      unsynced,
      stuck,
      stuckOrders,
      attention,
      attentionOrders,
      catalog: catalogRun,
    };
  }

  private async gomdonHealth(now: Date, t: OpsThresholds) {
    const since = new Date(now.getTime() - DAY_MS);
    const backlogWhere = gomdonBacklogWhere(now, t.gomdonBacklogMinutes);
    const [
      cfg,
      lastByStatus,
      webhookFailed24h,
      webhookFailedOpen,
      failedEvents,
      openAlerts,
      alerts,
      attention,
      attentionOrders,
      backlog,
      backlogOrders,
    ] = await Promise.all([
      this.gomdon?.getConfig().catch(() => null) ?? Promise.resolve(null),
      Promise.all(
        GOMDON_STATUSES.map((status) =>
          this.prisma.gomdonWebhookEvent.findFirst({ where: { status }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
        ),
      ),
      this.prisma.gomdonWebhookEvent.count({ where: { status: GOMDON_EVENT_STATUS.FAILED, receivedAt: { gte: since } } }),
      this.prisma.gomdonWebhookEvent.count({ where: GOMDON_OPEN_EVENT_WHERE }),
      this.prisma.gomdonWebhookEvent.findMany({
        where: GOMDON_OPEN_EVENT_WHERE,
        orderBy: { receivedAt: 'asc' },
        take: STUCK_LIST,
        select: { id: true, gomdonStatus: true, orderCode: true, status: true, attempts: true, error: true, receivedAt: true },
      }),
      this.prisma.gomdonAlert.count({ where: { resolvedAt: null } }),
      this.prisma.gomdonAlert.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'asc' },
        take: STUCK_LIST,
        select: { id: true, message: true, createdAt: true, order: { select: { code: true } } },
      }),
      this.prisma.order.count({ where: recyclingAttentionWhere() }),
      this.prisma.order.findMany({
        where: recyclingAttentionWhere(),
        orderBy: { createdAt: 'asc' },
        take: STUCK_LIST,
        select: { id: true, code: true, gomdonStatus: true, gomdonCancelStatus: true },
      }),
      this.prisma.order.count({ where: backlogWhere }),
      this.prisma.order.findMany({
        where: backlogWhere,
        orderBy: { createdAt: 'asc' },
        take: STUCK_LIST,
        select: { id: true, code: true, createdAt: true, gomdonStatus: true, paymentMethod: true },
      }),
    ]);
    const connection = (await this.gomdon?.getHealth()) ?? null;
    const lastWebhook = lastByStatus.reduce<Date | null>((m, r) => (r && (!m || r.receivedAt > m) ? r.receivedAt : m), null);
    return {
      configured: cfg ? hasGomdonCredentials(cfg) : false,
      connection,
      credentialsRejected: connection?.credentialsRejected ?? false,
      lastWebhookAt: lastWebhook?.toISOString() ?? null,
      webhookFailed24h,
      webhookFailedOpen,
      failedEvents: failedEvents.map(({ gomdonStatus, orderCode, error, ...e }) => ({
        ...e,
        source: 'gomdon' as const,
        eventType: gomdonStatus == null ? 'không rõ trạng thái' : `trạng thái ${gomdonStatus}`,
        orderRef: orderCode,
        error: error?.slice(0, 300) ?? null,
      })),
      openAlerts,
      alerts: alerts.map(({ order, ...a }) => ({ ...a, orderCode: order.code })),
      attention,
      attentionOrders,
      backlog,
      backlogOrders,
    };
  }

  private async queueHealth(now: Date): Promise<QueueHealth> {
    const hourAgo = now.getTime() - 3_600_000;
    try {
      const items = await withQueueTimeout(
        Promise.all(
          this.queues.map(async (q) => {
            const [counts, failedJobs] = await Promise.all([
              q.getJobCounts('waiting', 'active', 'delayed', 'failed'),
              q.getFailed(0, FAILED_SCAN - 1),
            ]);
            return {
              name: q.name,
              waiting: counts.waiting ?? 0,
              active: counts.active ?? 0,
              delayed: counts.delayed ?? 0,
              failed: counts.failed ?? 0,
              failedLastHour: failedJobs.filter((j) => (j.finishedOn ?? 0) >= hourAgo).length,
            };
          }),
        ),
        'ops health queues',
      );
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  recordCatalogRun(run: CatalogRunResult, now = new Date()) {
    return recordCatalogRun(this.prisma, run, now);
  }

  @Cron('0 */5 * * * *', { name: 'ops.health-alert', timeZone: CRON_TZ })
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const res = await this.checkAndAlert();
      if (res.sent) this.logger.warn(`Sức khoẻ vận hành: ${res.sent} — ${res.problems.map((p) => p.key).join(', ') || 'hết sự cố'}.`);
    } catch (err) {
      this.logger.error(`Cron sức khoẻ vận hành lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Báo in-app một lần cho mỗi quyết định ALERT/RECOVERED; webhook ngoài và email gửi đúng quyết định đó. Mỗi kênh ngoài
   * gửi không được (lỗi mạng, HTTP/SMTP lỗi) thì nhớ `webhookPending` / `emailPending` và lượt cron sau (5 phút) chỉ kênh
   * đó gửi lại với tình trạng mới nhất, không chờ tới giờ nhắc lại — kênh đã gửi được không bị gửi lại, nên email không
   * bao giờ nhiều hơn webhook. Hai kênh chạy song song và không kênh nào ném lỗi ra ngoài.
   *
   * Riêng email có lỗi vĩnh viễn (sai tài khoản/mật khẩu SMTP, máy chủ từ chối hẳn): nhớ `emailBlocked` thay vì
   * `emailPending`, KHÔNG gửi lại mỗi 5 phút (đập vào Gmail/Workspace có thể khoá tài khoản gửi). Chỉ thử lại khi cấu hình đổi,
   * admin gửi email thử thành công, hoặc bộ sự cố đổi (quyết định ALERT có loại sự cố mới, hay RECOVERED) — đúng một lần mỗi
   * lần đổi; hàng việc tăng thêm và nhắc lại sau `repeatHours` không thử lại email trong lúc bị chặn.
   */
  async checkAndAlert(now = new Date()): Promise<{ sent: 'ALERT' | 'RECOVERED' | null; problems: OpsProblem[] }> {
    const snap = await this.snapshot(now);
    const row = await this.prisma.opsHealthState.findUnique({ where: { key: ALERT_STATE_KEY } });
    const detail = (row?.detail ?? null) as {
      keys?: string[];
      tracked?: AlertMemory['tracked'];
      webhookPending?: boolean;
      emailPending?: boolean;
      emailBlocked?: boolean;
    } | null;
    const prev: AlertMemory | null = row
      ? { keys: (detail?.keys ?? []).slice(), alertSince: row.alertSince, alertedAt: row.alertedAt, tracked: detail?.tracked }
      : null;
    const { send, next } = decideAlert(prev, snap.problems, now, snap.thresholds.repeatHours);
    if (send) await this.notifyInApp(send, snap.problems, prev?.alertSince ?? null, now);
    const retryKind = snap.problems.length > 0 ? 'ALERT' : 'RECOVERED';
    const since = send ? (prev?.alertSince ?? null) : null;
    const webhookKind = send ?? (detail?.webhookPending ? retryKind : null);
    let emailKind = send ?? (detail?.emailPending ? retryKind : null);
    if (detail?.emailBlocked) {
      if (await this.emailBlockLifted()) emailKind ??= retryKind;
      // Hàng việc tăng thêm / nhắc lại cũng là quyết định ALERT nhưng không phải tình huống mới: chỉ bộ sự cố đổi (có loại
      // sự cố mới, hoặc hết sự cố) mới đáng một lần thử lại với thông tin đăng nhập đã biết là sai.
      else if (!sameKeys(prev?.keys ?? [], next.keys)) emailKind = send;
      else emailKind = null;
    }
    const [webhookOk, emailOutcome] = await Promise.all([
      webhookKind ? this.sendWebhook(webhookKind, snap.problems, since, now) : true,
      emailKind ? this.sendEmail(emailKind, snap.problems, since, now) : null,
    ]);
    const emailBlocked = emailOutcome === 'BLOCKED' || (emailOutcome === null && detail?.emailBlocked === true);
    const data = {
      detail: {
        keys: next.keys,
        ...(next.tracked ? { tracked: next.tracked } : {}),
        ...(webhookOk ? {} : { webhookPending: true }),
        ...(emailOutcome === 'RETRY' ? { emailPending: true } : {}),
        ...(emailBlocked ? { emailBlocked: true } : {}),
      },
      alertSince: next.alertSince,
      alertedAt: next.alertedAt,
    };
    await this.prisma.opsHealthState.upsert({ where: { key: ALERT_STATE_KEY }, create: { key: ALERT_STATE_KEY, ...data }, update: data });
    return { sent: send, problems: snap.problems };
  }

  private message(kind: 'ALERT' | 'RECOVERED', problems: OpsProblem[], since: Date | null, now: Date): AlertMessage {
    const title = kind === 'ALERT' ? '⚠️ Sự cố vận hành' : '✅ Vận hành đã ổn trở lại';
    const summary =
      kind === 'ALERT'
        ? problems.map((p) => p.message).join('; ')
        : `Hết sự cố${since ? ` bắt đầu lúc ${formatVnDateTime(since)}` : ''} (kiểm lúc ${formatVnDateTime(now)}).`;
    return { status: kind, title, summary, problems, generatedAt: now.toISOString() };
  }

  private async notifyInApp(kind: 'ALERT' | 'RECOVERED', problems: OpsProblem[], since: Date | null, now: Date) {
    const { title, summary } = this.message(kind, problems, since, now);
    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_HEALTH_ALERT', subject: `sức khoẻ vận hành (${kind})`, data: () => ({ title, summary }) },
    ).catch((e: unknown) => this.logger.warn(`Báo admin sức khoẻ vận hành lỗi: ${e instanceof Error ? e.message : e}`));
  }

  /** true = đã gửi được, không cần gửi (chưa đặt URL), hoặc bị từ chối vĩnh viễn (4xx trừ 408/429) nên không có gì để gửi lại. */
  private async sendWebhook(kind: 'ALERT' | 'RECOVERED', problems: OpsProblem[], since: Date | null, now: Date): Promise<boolean> {
    const url = this.webhookUrl();
    const send = this.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!url || !send) return true;
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alertWebhookBody(url, this.message(kind, problems, since, now))),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.ok) {
        await this.recordWebhook({ ok: true }, now);
        return true;
      }
      if (isPermanentWebhookStatus(res.status)) {
        await this.recordWebhook({ ok: false, error: `HTTP ${res.status}`, kind: 'PERMANENT' }, now);
        this.logger.warn(`Webhook báo động vận hành bị từ chối HTTP ${res.status} (lỗi vĩnh viễn) — không gửi lại; kiểm tra OPS_ALERT_WEBHOOK_URL.`);
        return true;
      }
      await this.recordWebhook({ ok: false, error: `HTTP ${res.status}`, kind: 'TRANSIENT' }, now);
      this.logger.warn(`Webhook báo động vận hành trả HTTP ${res.status} — gửi lại ở lượt kiểm sau.`);
    } catch (e) {
      await this.recordWebhook({ ok: false, error: scrubWebhookUrl(e instanceof Error ? e.message : String(e), url), kind: 'TRANSIENT' }, now);
      this.logger.warn(`Webhook báo động vận hành lỗi: ${e instanceof Error ? e.message : e} — gửi lại ở lượt kiểm sau.`);
    }
    return false;
  }

  /** DONE = đã gửi được hoặc không cần gửi (chưa cấu hình email). OpsEmailService không ném; bắt thêm để cron không bao giờ đổ vì email. */
  private async sendEmail(kind: 'ALERT' | 'RECOVERED', problems: OpsProblem[], since: Date | null, now: Date): Promise<EmailAlertOutcome> {
    if (!this.email) return 'DONE';
    try {
      return await this.email.sendAlert(this.message(kind, problems, since, now));
    } catch (e) {
      this.logger.warn(`Email báo động vận hành lỗi: ${e instanceof Error ? e.message : e} — gửi lại ở lượt kiểm sau.`);
      return 'RETRY';
    }
  }

  private async emailBlockLifted(): Promise<boolean> {
    if (!this.email) return true;
    try {
      return await this.email.blockLifted();
    } catch {
      return false;
    }
  }
}
