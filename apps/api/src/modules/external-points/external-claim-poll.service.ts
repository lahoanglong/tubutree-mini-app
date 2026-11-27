import { Injectable, Logger } from '@nestjs/common';
import { RunLease } from '../../common/cron-leader/run-lease';
import { PrismaService } from '../../prisma/prisma.service';
import { PancakeClient } from '../integrations/pancake/pancake.client';
import { NotificationsService } from '../notifications/notifications.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { EXTERNAL_POLL_ENABLED_KEY } from './external-claim.config';
import { ORDER_SOURCE_MAP_KEY, resolveOrderSourceMap } from './external-order.config';
import { ingestAndApply } from './external-order.sync';

const POLL_LEASE = 'external-orders-poll';
const POLL_LEASE_TTL_MS = 5 * 60_000;
const POLL_WINDOW_MS = 2 * 3600_000;
const MAX_PAGES = 20;
const PAGE_SIZE = 50;
/** Số đơn lỗi được ghi riêng từng dòng log mỗi lượt; các đơn lỗi sau chỉ vào dòng tổng (DB rớt thì cả trang lỗi, không xả 50 dòng). */
const MAX_FAILED_ORDER_LOGS = 3;
/**
 * Ngần này đơn liền nhau của một nguồn nạp lỗi (thường là DB rớt) thì bỏ phần còn lại của nguồn đó: không để mỗi đơn còn lại chờ hết hạn
 * kết nối rồi kéo một trang quá hạn khoá. Nguồn sau vẫn được thử.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface PollResult {
  pages: number;
  ingested: number;
  /** Đơn nạp lỗi trong lượt (đã bỏ qua, các đơn khác vẫn nạp). */
  failed: number;
}

/** id Pancake của đơn để ghi log (không phải dữ liệu khách); payload lạ thì '?'. */
function orderIdOf(o: unknown): string {
  const id = o !== null && typeof o === 'object' ? (o as { id?: unknown }).id : undefined;
  return typeof id === 'string' || typeof id === 'number' ? String(id).slice(0, 40) : '?';
}

const errorKind = (err: unknown): string => (err instanceof Error ? err.constructor.name || 'Error' : typeof err);

/**
 * Kéo dự phòng khi webhook sàn hoặc đơn chat rớt: lấy đơn của các nguồn đã cập nhật trong 2 giờ gần nhất và nạp như webhook. Sau cờ
 * `pancake.external_poll_enabled` (mặc định tắt: chưa biết định dạng `startDateTime` và `order_sources` trên Pancake thật).
 * RunLease để nhiều replica không kéo trùng. Tối đa 20 trang mỗi lượt.
 *
 * Mỗi đơn nạp trong try/catch riêng: một đơn Pancake hỏng (payload lạ, vướng ràng buộc DB) không bỏ dở phần còn lại của trang, của nguồn
 * hay của lượt. Đơn lỗi được đếm (`failed`, chia theo loại lỗi trong log tổng) và nạp lại ở lượt kéo sau vì vẫn nằm trong cửa sổ 2 giờ.
 * Lỗi liền nhau `MAX_CONSECUTIVE_FAILURES` đơn thì bỏ phần còn lại của nguồn như lỗi nguồn.
 */
@Injectable()
export class ExternalClaimPollService {
  private readonly logger = new Logger(ExternalClaimPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async pollOnce(now: Date = new Date()): Promise<PollResult | null> {
    if ((await this.config.get<unknown>(EXTERNAL_POLL_ENABLED_KEY, false)) !== true || !this.client.isConfigured()) return null;
    const map = resolveOrderSourceMap(await this.config.get<unknown>(ORDER_SOURCE_MAP_KEY, null));
    // Nguồn sàn (marketplace_id) và nguồn chat/điện thoại (phần `order_sources` đứng đầu mỗi khoá trong chatSources): webhook rớt thì cả hai loại đơn đều được kéo bù.
    const chatSourceIds = map.chatSources.map((k) => k.split('|')[0]!.trim()).filter((v) => /^-?\d+$/.test(v));
    const sources = [...new Set([...Object.keys(map.marketplaceIds), ...chatSourceIds])];
    if (sources.length === 0) return null;
    const lease = await RunLease.tryAcquire(this.prisma, POLL_LEASE, POLL_LEASE_TTL_MS);
    if (!lease) return null;
    let pages = 0;
    let ingested = 0;
    let failed = 0;
    const failedKinds: Record<string, number> = {};
    const failedIds: string[] = [];
    let leaseLost = false;
    try {
      const sinceSec = Math.floor((now.getTime() - POLL_WINDOW_MS) / 1000);
      // Pancake chỉ lọc theo giá trị `order_sources[]` CUỐI khi nhận nhiều giá trị (PROD 27/11: [-3,-4,-9] chỉ trả đơn -9, bỏ sót 17 đơn
      // Shopee và 4 đơn Lazada trong 2 giờ), nên mỗi nguồn kéo riêng. Lỗi ở một nguồn không chặn các nguồn sau.
      for (const source of sources) {
        if (leaseLost) break;
        let streak = 0;
        try {
          for (let page = 1; page <= MAX_PAGES; page++) {
            if (pages > 0 && !(await lease.renew().catch(() => false))) {
              leaseLost = true;
              break;
            }
            const orders = await this.client.listUpdatedOrders({ sinceEpochSec: sinceSec, orderSources: [source], page, pageSize: PAGE_SIZE });
            pages++;
            for (const o of orders) {
              try {
                const out = await ingestAndApply(this.prisma, { notifier: this.notifications, config: this.config, recalcTier: (id) => this.loyalty.recalcTier(id) }, o as unknown as Record<string, unknown>, map, now);
                if (out.result === 'STORED') ingested++;
                streak = 0;
              } catch (err) {
                failed++;
                streak++;
                const kind = errorKind(err);
                failedKinds[kind] = (failedKinds[kind] ?? 0) + 1;
                const id = orderIdOf(o);
                if (failedIds.length < MAX_FAILED_ORDER_LOGS) {
                  failedIds.push(id);
                  this.logger.warn(`Kéo dự phòng: nạp đơn ${id} (nguồn ${source}) lỗi ${kind}: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`);
                }
                if (streak >= MAX_CONSECUTIVE_FAILURES) throw new Error(`${streak} đơn liền nhau nạp lỗi (${kind}), bỏ phần còn lại của nguồn`);
              }
            }
            if (orders.length < PAGE_SIZE) break;
          }
        } catch (err) {
          this.logger.warn(`Kéo dự phòng đơn ngoài lỗi (nguồn ${source}): ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      await lease.release();
    }
    if (failed > 0) {
      this.logger.warn(`Kéo dự phòng: ${failed} đơn nạp lỗi, đã bỏ qua (pages=${pages} ingested=${ingested} failed=${failed} kinds=${JSON.stringify(failedKinds)} firstIds=${failedIds.join(',')})`);
    }
    return { pages, ingested, failed };
  }
}
