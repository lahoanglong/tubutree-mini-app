import { Injectable, Logger } from '@nestjs/common';
import { RunLease } from '../../common/cron-leader/run-lease';
import { PrismaService } from '../../prisma/prisma.service';
import { PancakeClient } from '../integrations/pancake/pancake.client';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { EXTERNAL_POLL_ENABLED_KEY } from './external-claim.config';
import { ORDER_SOURCE_MAP_KEY, resolveOrderSourceMap } from './external-order.config';
import { ingestAndApply } from './external-order.sync';

const POLL_LEASE = 'external-orders-poll';
const POLL_LEASE_TTL_MS = 5 * 60_000;
const POLL_WINDOW_MS = 2 * 3600_000;
const MAX_PAGES = 20;
const PAGE_SIZE = 50;

/**
 * Kéo dự phòng khi webhook sàn rớt: lấy đơn của các sàn đã cập nhật trong 2 giờ gần nhất và nạp như webhook. Sau cờ
 * `pancake.external_poll_enabled` (mặc định tắt: chưa biết định dạng `startDateTime` và `order_sources` trên Pancake thật).
 * RunLease để nhiều replica không kéo trùng. Tối đa 20 trang mỗi lượt.
 */
@Injectable()
export class ExternalClaimPollService {
  private readonly logger = new Logger(ExternalClaimPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async pollOnce(now: Date = new Date()): Promise<{ pages: number; ingested: number } | null> {
    if ((await this.config.get<unknown>(EXTERNAL_POLL_ENABLED_KEY, false)) !== true || !this.client.isConfigured()) return null;
    const map = resolveOrderSourceMap(await this.config.get<unknown>(ORDER_SOURCE_MAP_KEY, null));
    const sources = Object.keys(map.marketplaceIds);
    if (sources.length === 0) return null;
    const lease = await RunLease.tryAcquire(this.prisma, POLL_LEASE, POLL_LEASE_TTL_MS);
    if (!lease) return null;
    let pages = 0;
    let ingested = 0;
    try {
      const sinceSec = Math.floor((now.getTime() - POLL_WINDOW_MS) / 1000);
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (page > 1 && !(await lease.renew())) break;
        const orders = await this.client.listUpdatedOrders({ sinceEpochSec: sinceSec, orderSources: sources, page, pageSize: PAGE_SIZE });
        pages++;
        for (const o of orders) {
          const out = await ingestAndApply(this.prisma, { notifier: this.notifications, config: this.config }, o as unknown as Record<string, unknown>, map, now);
          if (out.result === 'STORED') ingested++;
        }
        if (orders.length < PAGE_SIZE) break;
      }
    } catch (err) {
      this.logger.warn(`Kéo dự phòng đơn ngoài lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      await lease.release();
    }
    return { pages, ingested };
  }
}
