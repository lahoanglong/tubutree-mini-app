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
import { PANCAKE_EVENT_STATUS } from '../integrations/pancake/pancake-webhook-dedupe';
import { GOMDON_EVENT_STATUS } from '../integrations/gomdon/gomdon-webhook.service';
import { pancakeUnsyncedWhere, recyclingAttentionWhere } from '../admin/admin-order-filter';
import {
  decideAlert,
  OPS_THRESHOLD_KEYS,
  opsProblems,
  type AlertMemory,
  type CatalogRun,
  type OpsProblem,
  type OpsThresholds,
} from './ops-alerts';
import { CATALOG_STATE_KEY, recordCatalogRun, type CatalogRunResult } from './ops-state';

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
/** Webhook nhận rồi mà quá chừng này vẫn RECEIVED/PROCESSING = worker không chạy. */
const WEBHOOK_STUCK_MS = 10 * 60_000;
const DAY_MS = 24 * 3_600_000;
/** Job lỗi trong 1 giờ: chỉ xem chừng này job lỗi mới nhất (BullMQ giữ tối đa 1000 job lỗi mỗi hàng đợi). */
const FAILED_SCAN = 200;
const WEBHOOK_TIMEOUT_MS = 5000;

const PANCAKE_STATUSES = Object.values(PANCAKE_EVENT_STATUS);
const GOMDON_STATUSES = Object.values(GOMDON_EVENT_STATUS);

export type QueueHealth =
  | { ok: true; items: { name: string; waiting: number; active: number; delayed: number; failed: number; failedLastHour: number }[] }
  | { ok: false; error: string };

/**
 * Sức khoẻ vận hành (PLATFORM-5): Pancake (đẩy đơn, webhook, danh mục), Gomdon (webhook, đăng nhập, báo động), các
 * hàng đợi BullMQ và đơn kẹt. Cron 5 phút so với ngưỡng `ops.*` rồi báo admin in-app (thêm webhook ngoài nếu đặt
 * OPS_ALERT_WEBHOOK_URL); @Cron chỉ chạy trên instance giữ khoá leader (CronLeaderService).
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
    const [pancake, gomdon, queues] = await Promise.all([this.pancakeHealth(now, t), this.gomdonHealth(now), this.queueHealth(now)]);
    const problems = opsProblems({ pancake, gomdon, queues }, t);
    return { generatedAt: now.toISOString(), thresholds: t, pancake, gomdon, queues, problems };
  }

  private pancakeConfigured(): boolean {
    return Boolean(this.config.get('PANCAKE_API_KEY', { infer: true }) && this.config.get('PANCAKE_SHOP_ID', { infer: true }));
  }

  private async pancakeHealth(now: Date, t: OpsThresholds) {
    const since = new Date(now.getTime() - DAY_MS);
    const stuckWhere: Prisma.OrderWhereInput = {
      AND: [pancakeUnsyncedWhere(now), { createdAt: { lt: new Date(now.getTime() - t.unsyncedMinutes * 60_000) } }],
    };
    const [lastPush, lastByStatus, lastProcessed, webhookFailed24h, webhookStuck, unsynced, stuck, stuckOrders, attention, catalog] =
      await Promise.all([
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
        this.prisma.pancakeWebhookEvent.count({
          where: {
            status: { in: [PANCAKE_EVENT_STATUS.RECEIVED, PANCAKE_EVENT_STATUS.PROCESSING] },
            receivedAt: { gte: since, lt: new Date(now.getTime() - WEBHOOK_STUCK_MS) },
          },
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
      webhookStuck,
      unsynced,
      stuck,
      stuckOrders,
      attention,
      catalog: catalogRun,
    };
  }

  private async gomdonHealth(now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    const [cfg, lastByStatus, webhookFailed24h, openAlerts, attention] = await Promise.all([
      this.gomdon?.getConfig().catch(() => null) ?? Promise.resolve(null),
      Promise.all(
        GOMDON_STATUSES.map((status) =>
          this.prisma.gomdonWebhookEvent.findFirst({ where: { status }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
        ),
      ),
      this.prisma.gomdonWebhookEvent.count({ where: { status: GOMDON_EVENT_STATUS.FAILED, receivedAt: { gte: since } } }),
      this.prisma.gomdonAlert.count({ where: { resolvedAt: null } }),
      this.prisma.order.count({ where: recyclingAttentionWhere() }),
    ]);
    const connection = this.gomdon?.getHealth() ?? null;
    const lastWebhook = lastByStatus.reduce<Date | null>((m, r) => (r && (!m || r.receivedAt > m) ? r.receivedAt : m), null);
    return {
      configured: cfg ? hasGomdonCredentials(cfg) : false,
      connection,
      credentialsRejected: connection?.credentialsRejected ?? false,
      lastWebhookAt: lastWebhook?.toISOString() ?? null,
      webhookFailed24h,
      openAlerts,
      attention,
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

  async checkAndAlert(now = new Date()): Promise<{ sent: 'ALERT' | 'RECOVERED' | null; problems: OpsProblem[] }> {
    const snap = await this.snapshot(now);
    const row = await this.prisma.opsHealthState.findUnique({ where: { key: ALERT_STATE_KEY } });
    const prev: AlertMemory | null = row
      ? { keys: ((row.detail as { keys?: string[] } | null)?.keys ?? []).slice(), alertSince: row.alertSince, alertedAt: row.alertedAt }
      : null;
    const { send, next } = decideAlert(prev, snap.problems, now, snap.thresholds.repeatHours);
    const data = { detail: { keys: next.keys }, alertSince: next.alertSince, alertedAt: next.alertedAt };
    await this.prisma.opsHealthState.upsert({ where: { key: ALERT_STATE_KEY }, create: { key: ALERT_STATE_KEY, ...data }, update: data });
    if (send) await this.dispatch(send, snap.problems, prev?.alertSince ?? null, now);
    return { sent: send, problems: snap.problems };
  }

  private async dispatch(kind: 'ALERT' | 'RECOVERED', problems: OpsProblem[], since: Date | null, now: Date) {
    const title = kind === 'ALERT' ? '⚠️ Sự cố vận hành' : '✅ Vận hành đã ổn trở lại';
    const summary =
      kind === 'ALERT'
        ? problems.map((p) => p.message).join('; ')
        : `Hết sự cố${since ? ` bắt đầu lúc ${formatVnDateTime(since)}` : ''} (kiểm lúc ${formatVnDateTime(now)}).`;
    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_HEALTH_ALERT', subject: `sức khoẻ vận hành (${kind})`, data: () => ({ title, summary }) },
    ).catch((e: unknown) => this.logger.warn(`Báo admin sức khoẻ vận hành lỗi: ${e instanceof Error ? e.message : e}`));

    const url = String(this.config.get('OPS_ALERT_WEBHOOK_URL', { infer: true }) ?? '').trim();
    const send = this.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!url || !send) return;
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: kind, title, summary, problems, generatedAt: now.toISOString() }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) this.logger.warn(`Webhook báo động vận hành trả HTTP ${res.status}.`);
    } catch (e) {
      this.logger.warn(`Webhook báo động vận hành lỗi: ${e instanceof Error ? e.message : e}`);
    }
  }
}
