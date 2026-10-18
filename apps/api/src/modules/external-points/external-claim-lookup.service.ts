import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeClient } from '../integrations/pancake/pancake.client';
import { SystemConfigService } from '../system-config/system-config.service';
import { EXTERNAL_LOOKUP_ENABLED_KEY } from './external-claim.config';
import { ORDER_SOURCE_MAP_KEY, resolveOrderSourceMap } from './external-order.config';
import { extractTrackingCodes, marketplaceOrderSn } from './external-order.mapper';
import { ingestAndApply } from './external-order.sync';

const LOOKUP_TIMEOUT_MS = 5_000;
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 5 * 60_000;

/**
 * Tra Pancake theo mã vận đơn khi mã chưa có trong external_orders (webhook chưa tới). Sau cờ `pancake.external_lookup_enabled`
 * (mặc định tắt: chưa biết `search` của GET /orders có tìm theo mã vận đơn không). Ngắt mạch trong bộ nhớ: 3 lỗi liên tiếp thì
 * nghỉ 5 phút để Pancake chậm hay sập không kéo theo mọi request gửi mã của khách. Không bao giờ ném.
 */
@Injectable()
export class ExternalClaimLookupService {
  private readonly logger = new Logger(ExternalClaimLookupService.name);
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /** true khi tra được ít nhất một đơn khớp đúng mã và đã nạp vào external_orders. */
  async lookupAndIngest(code: string, now: Date = new Date()): Promise<boolean> {
    try {
      if ((await this.config.get<unknown>(EXTERNAL_LOOKUP_ENABLED_KEY, false)) !== true) return false;
      if (!this.client.isConfigured() || now.getTime() < this.openUntil) return false;
      let orders;
      try {
        orders = await this.client.searchOrders(code, { timeoutMs: LOOKUP_TIMEOUT_MS });
        this.failures = 0;
      } catch (err) {
        this.failures++;
        if (this.failures >= BREAKER_THRESHOLD) {
          this.openUntil = now.getTime() + BREAKER_OPEN_MS;
          this.failures = 0;
          this.logger.warn(`Tra Pancake lỗi ${BREAKER_THRESHOLD} lần liên tiếp, nghỉ 5 phút: ${err instanceof Error ? err.message : err}`);
        }
        return false;
      }
      const map = resolveOrderSourceMap(await this.config.get<unknown>(ORDER_SOURCE_MAP_KEY, null));
      let ingested = 0;
      for (const order of orders) {
        const data = order as unknown as Record<string, unknown>;
        // `search` là tìm chữ tự do: chỉ nhận đơn mang ĐÚNG mã này, không đơn khác có chữ giống.
        const matches = extractTrackingCodes(data).includes(code) || marketplaceOrderSn(data) === code;
        if (!matches) continue;
        const out = await ingestAndApply(this.prisma, { notifier: this.notifications, config: this.config }, data, map, now);
        if (out.result !== 'NOT_EXTERNAL') ingested++;
      }
      return ingested > 0;
    } catch (err) {
      this.logger.warn(`lookupAndIngest lỗi: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
