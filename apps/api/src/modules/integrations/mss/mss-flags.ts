import { Inject, Injectable, Optional } from '@nestjs/common';
import { SystemConfigService } from '../../system-config/system-config.service';
import { isMssConfigured, readMssEnv, type MssEnv } from './mss-config';
import {
  clampRolloutPct,
  MSS_CATALOG_SOURCE_KEY,
  MSS_FLAG_KEYS,
  MSS_FLAGS,
  MSS_ORDER_CONSENT_PRECHECKED_KEY,
  MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY,
  parseCatalogSource,
  type MssCatalogSource,
  type MssFlag,
} from './mss-flag-keys';

export * from './mss-flag-keys';

export interface MssFlagsSnapshot {
  /** Giá trị admin đặt (`=== true`), chưa xét biến môi trường hay năng lực MSS. */
  raw: Record<MssFlag, boolean>;
  orderEventsRolloutPct: number;
  orderConsentPrechecked: boolean;
  catalogSource: MssCatalogSource;
}

/** Json trong system_configs: chuỗi "false" vẫn truthy, nên chỉ đúng `true` mới là bật. */
function isOn(v: unknown): boolean {
  return v === true;
}

/** Đọc env mỗi lần gọi (rẻ) để test và lần đặt lại biến sau khởi động lại cùng một đường. */
export const MSS_ENV_READER = Symbol('MSS_ENV_READER');
export type MssEnvReader = () => MssEnv;

@Injectable()
export class MssFlagsService {
  private readonly readEnv: MssEnvReader;

  constructor(
    private readonly config: SystemConfigService,
    @Optional() @Inject(MSS_ENV_READER) readEnv?: MssEnvReader,
  ) {
    this.readEnv = readEnv ?? (() => readMssEnv());
  }

  env(): MssEnv {
    return this.readEnv();
  }

  configured(): boolean {
    return isMssConfigured(this.readEnv());
  }

  async snapshot(): Promise<MssFlagsSnapshot> {
    const [raw, pct, prechecked, source] = await Promise.all([
      Promise.all(MSS_FLAGS.map(async (f) => [f, isOn(await this.config.get<unknown>(MSS_FLAG_KEYS[f], false))] as const)),
      this.config.get<unknown>(MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY, 0),
      this.config.get<unknown>(MSS_ORDER_CONSENT_PRECHECKED_KEY, false),
      this.config.get<unknown>(MSS_CATALOG_SOURCE_KEY, 'pancake'),
    ]);
    return {
      raw: Object.fromEntries(raw) as Record<MssFlag, boolean>,
      orderEventsRolloutPct: clampRolloutPct(pct),
      orderConsentPrechecked: isOn(prechecked),
      catalogSource: parseCatalogSource(source),
    };
  }

  /** Cờ bật VÀ đủ biến môi trường. Chưa xét năng lực MSS: đường chạy thật dùng MssHealthService.assertCapability. */
  async isEnabled(flag: MssFlag): Promise<boolean> {
    if (!this.configured()) return false;
    return isOn(await this.config.get<unknown>(MSS_FLAG_KEYS[flag], false));
  }

  /** Ít nhất một tính năng MSS đang được yêu cầu (cờ bật hoặc nguồn danh mục là MSS) và đủ biến: khi đó mới hỏi sức khoẻ MSS. */
  async anyRequested(): Promise<boolean> {
    if (!this.configured()) return false;
    const s = await this.snapshot();
    return MSS_FLAGS.some((f) => s.raw[f]) || s.catalogSource === 'mss';
  }
}
