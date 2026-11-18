import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../../system-config/system-config.service';
import { MAX_VITALS_PER_BATCH, PERF_RUM_ENABLED_KEY, isVitalEventName } from './vitals-rules';

/**
 * Cổng phía máy chủ của số đo tốc độ: cờ `perf.rum_enabled` tắt thì bỏ mọi `web_vital`/`mini_vital` (bản app cũ hay người gửi giả vẫn không
 * ghi được dòng nào), bật thì nhận tối đa `MAX_VITALS_PER_BATCH` số đo một lô. Lô không có số đo nào thì không đọc cấu hình.
 */
@Injectable()
export class VitalsIngestGate {
  constructor(private readonly config: SystemConfigService) {}

  async filter<T extends { eventName: string }>(events: T[]): Promise<T[]> {
    if (!events.some((e) => isVitalEventName(e.eventName))) return events;
    let on = false;
    try {
      on = (await this.config.get<unknown>(PERF_RUM_ENABLED_KEY, false)) === true;
    } catch {
      on = false;
    }
    let kept = 0;
    return events.filter((e) => !isVitalEventName(e.eventName) || (on && ++kept <= MAX_VITALS_PER_BATCH));
  }
}
