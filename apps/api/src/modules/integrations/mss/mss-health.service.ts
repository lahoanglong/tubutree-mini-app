import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { notifyAdmins } from '../../../common/notify-admins';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isMssConfigured, type MssEnvStatus } from './mss-config';
import { MSS_SHARED_STORE, type MssCircuitSnapshot, type MssSharedStore } from './mss-circuit';
import { MSS_FLAG_CAPABILITY, MSS_FLAG_KEYS, MSS_FLAGS, MssFlagsService, type MssCatalogSource, type MssFlag } from './mss-flags';
import { MssClient, MssRequestError } from './mss.client';

/** Đọc `/health` của MSS 5 phút một lần, chỉ khi có ít nhất một cờ MSS bật và đủ biến (cờ tắt: không gọi MSS, không ghi gì). */
export const MSS_HEALTH_POLL_CRON = '0 */5 * * * *';
/** Kết quả dò cũ hơn chừng này (3 lượt dò liên tiếp không có) coi như chưa biết năng lực: mọi cờ coi như tắt. */
export const MSS_HEALTH_STALE_MS = 15 * 60_000;
/** Cờ bật mà thiếu năng lực: báo Ops tối đa một lần mỗi giờ cho mỗi cờ. */
export const MSS_CAPABILITY_WARN_MS = 60 * 60_000;
/** Hỏi lại `/health` theo nhu cầu (khi chưa có kết quả) tối đa một lần mỗi chừng này. */
const ON_DEMAND_REFRESH_MS = 60_000;

const HEALTH_KEY = 'tubu:mss:health';
const capWarnKey = (flag: MssFlag) => `tubu:mss:capwarn:${flag}`;

export interface MssHealthState {
  checkedAt: string;
  ok: boolean;
  capabilities: string[];
  contract: string | Record<string, string> | null;
  /** Loại lỗi (`timeout`, `unauthorized`…) của lần dò hỏng; không chứa nội dung phản hồi. */
  error: string | null;
}

export interface MssOpsFlag {
  flag: MssFlag;
  key: string;
  /** Giá trị admin đặt. */
  enabled: boolean;
  capability: string;
  /** MSS có công bố năng lực này ở lần dò gần nhất còn hạn không (null: chưa có lần dò nào còn hạn). */
  capabilityPublished: boolean | null;
  /** Cờ có tác dụng thật: bật, đủ biến, MSS đã công bố năng lực. */
  effective: boolean;
}

export interface MssOpsCard {
  configured: boolean;
  env: MssEnvStatus;
  flags: MssOpsFlag[];
  orderEventsRolloutPct: number;
  orderConsentPrechecked: boolean;
  catalogSource: MssCatalogSource;
  /** Đang dò `/health` định kỳ (có cờ bật và đủ biến). */
  polling: boolean;
  health: MssHealthState | null;
  circuit: MssCircuitSnapshot;
}

function parseState(raw: string | null): MssHealthState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as MssHealthState;
    return typeof s?.checkedAt === 'string' && typeof s.ok === 'boolean' && Array.isArray(s.capabilities) ? s : null;
  } catch {
    return null;
  }
}

@Injectable()
export class MssHealthService {
  private readonly logger = new Logger(MssHealthService.name);
  private last: MssHealthState | null = null;
  private lastAttemptAt = 0;
  private inflight: Promise<MssHealthState> | null = null;
  private readonly warnedAt = new Map<MssFlag, number>();

  constructor(
    private readonly flags: MssFlagsService,
    private readonly client: MssClient,
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() @Inject(MSS_SHARED_STORE) private readonly store?: MssSharedStore,
  ) {}

  @Cron(MSS_HEALTH_POLL_CRON, { timeZone: CRON_TZ })
  async poll(): Promise<void> {
    try {
      if (!(await this.flags.anyRequested())) return;
      await this.refresh();
    } catch (err) {
      this.logger.error(`Dò sức khoẻ MSS lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Gọi `/health` một lần (các lời gọi đồng thời dùng chung), lưu vào bộ nhớ và Redis. Không ném. */
  refresh(): Promise<MssHealthState> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<MssHealthState> {
    this.lastAttemptAt = Date.now();
    let state: MssHealthState;
    try {
      const doc = await this.client.health();
      state = { checkedAt: new Date(Date.now()).toISOString(), ok: true, capabilities: doc.capabilities, contract: doc.contract, error: null };
    } catch (err) {
      const kind = err instanceof MssRequestError ? err.kind : 'internal';
      state = { checkedAt: new Date(Date.now()).toISOString(), ok: false, capabilities: [], contract: null, error: kind };
    }
    this.last = state;
    if (this.store) {
      await this.store.set(HEALTH_KEY, JSON.stringify(state), MSS_HEALTH_STALE_MS).catch(() => undefined);
    }
    return state;
  }

  /** Lần dò gần nhất còn hạn (bộ nhớ của tiến trình này hoặc của replica giữ cron qua Redis); null khi chưa có. */
  async current(now = Date.now()): Promise<MssHealthState | null> {
    let best = this.last;
    if (this.store) {
      const shared = parseState(await this.store.get(HEALTH_KEY).catch(() => null));
      if (shared && (!best || Date.parse(shared.checkedAt) > Date.parse(best.checkedAt))) best = shared;
    }
    if (!best || now - Date.parse(best.checkedAt) > MSS_HEALTH_STALE_MS) return null;
    return best;
  }

  /**
   * Cờ có hiệu lực cho đường chạy thật: bật, đủ biến VÀ MSS đã công bố năng lực tương ứng. Bật mà MSS chưa công bố (hoặc MSS không
   * trả lời) thì coi như tắt và báo Ops một lần mỗi giờ. Cờ tắt thì trả false ngay, không gọi MSS.
   */
  async assertCapability(flag: MssFlag): Promise<boolean> {
    if (!(await this.flags.isEnabled(flag))) return false;
    let health = await this.current();
    if (!health && Date.now() - this.lastAttemptAt >= ON_DEMAND_REFRESH_MS) health = await this.refresh();
    const capability = MSS_FLAG_CAPABILITY[flag];
    if (health?.ok && health.capabilities.includes(capability)) return true;
    await this.warnMissingCapability(flag, capability, health);
    return false;
  }

  private async warnMissingCapability(flag: MssFlag, capability: string, health: MssHealthState | null): Promise<void> {
    try {
      const now = Date.now();
      let first: boolean;
      if (this.store) {
        first = await this.store.setIfAbsent(capWarnKey(flag), String(now), MSS_CAPABILITY_WARN_MS).catch(() => this.memoryFirst(flag, now));
      } else {
        first = this.memoryFirst(flag, now);
      }
      if (!first) return;
      const why = !health ? 'chưa dò được /health của MSS' : !health.ok ? `MSS không trả lời tốt (${health.error ?? 'không rõ'})` : `MSS chưa công bố năng lực "${capability}"`;
      const summary = `Cờ ${MSS_FLAG_KEYS[flag]} đang bật nhưng ${why}. Tubu coi cờ này như tắt và đi đường cũ.`;
      this.logger.warn(summary);
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { template: 'OPS_HEALTH_ALERT', subject: `cờ MSS ${MSS_FLAG_KEYS[flag]} thiếu năng lực`, data: () => ({ title: 'Kết nối MSS', summary }) },
      );
    } catch (err) {
      this.logger.warn(`Không báo được Ops về cờ MSS ${MSS_FLAG_KEYS[flag]}: ${err instanceof Error ? err.message : err}`);
    }
  }

  private memoryFirst(flag: MssFlag, now: number): boolean {
    const at = this.warnedAt.get(flag);
    if (at !== undefined && now - at < MSS_CAPABILITY_WARN_MS) return false;
    this.warnedAt.set(flag, now);
    return true;
  }

  /** Dữ liệu thẻ "Kết nối MSS" ở màn Sức khoẻ hệ thống. Chỉ đọc trạng thái đã có: không gọi MSS, không in giá trị biến. */
  async opsCard(): Promise<MssOpsCard> {
    const env = this.flags.env();
    const configured = isMssConfigured(env);
    const [snap, health] = await Promise.all([this.flags.snapshot(), this.current()]);
    const flags = MSS_FLAGS.map((flag): MssOpsFlag => {
      const capability = MSS_FLAG_CAPABILITY[flag];
      const capabilityPublished = health ? health.ok && health.capabilities.includes(capability) : null;
      return {
        flag,
        key: MSS_FLAG_KEYS[flag],
        enabled: snap.raw[flag],
        capability,
        capabilityPublished,
        effective: configured && snap.raw[flag] && capabilityPublished === true,
      };
    });
    return {
      configured,
      env: env.status,
      flags,
      orderEventsRolloutPct: snap.orderEventsRolloutPct,
      orderConsentPrechecked: snap.orderConsentPrechecked,
      catalogSource: snap.catalogSource,
      polling: configured && (flags.some((f) => f.enabled) || snap.catalogSource === 'mss'),
      health,
      circuit: this.client.circuit.snapshot(),
    };
  }
}
