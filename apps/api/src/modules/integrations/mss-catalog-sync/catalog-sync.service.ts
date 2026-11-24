import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { HomeService } from '../../catalog/home.service';
import { PANCAKE_IGNORE_ZERO_STOCK_KEY, readKeepPositiveOnZero } from '../../catalog/variation-stock';
import { RestockAlertsDispatcher } from '../../restock-alerts/restock-alerts.dispatcher';
import { SystemConfigService } from '../../system-config/system-config.service';
import { MSS_PUSH_STATE_ID, MssCatalogService, type MssCatalogRunStats } from '../mss/catalog/mss-catalog.service';
import { MssHealthService } from '../mss/mss-health.service';
import type { CatalogSyncEnvelope } from './catalog-sync-body';
import { applyMssStock, type MssStockSkip } from './catalog-sync-stock';

/** `applied`: đã xử lý; `disabled`: cờ chưa có hiệu lực, không ghi gì; `none`: lô không có phần này. */
export type CatalogSyncPartStatus = 'applied' | 'disabled' | 'none';

export interface CatalogSyncReply {
  ok: true;
  sync_id: string;
  products: {
    status: CatalogSyncPartStatus;
    received: number;
    applied: number;
    unchanged: number;
    skipped: MssCatalogRunStats['skipped'];
    trimmed: MssCatalogRunStats['trimmed'];
    eco_proposed: number;
    eco_kept: number;
  };
  stock: {
    status: CatalogSyncPartStatus;
    received: number;
    applied: number;
    invalid: number;
    skipped: Partial<Record<MssStockSkip, number>>;
    out_of_stock: number;
    back_in_stock: number;
    /** Đăng ký "Báo tôi khi có hàng" đang chờ trên các biến thể vừa về hàng; lượt báo được gọi sớm, không đợi cron. */
    restock_waiting: number;
  };
  /** Phần MSS gửi mà bản này Tubu chưa áp, chỉ đếm (combo là đường tiền, cần hợp đồng giá riêng). */
  deferred: { bundles: number };
}

/** Đếm lưu vào `lastStats` của dòng `push`, đọc lại ở thẻ Ops. */
export interface MssPushStats {
  syncId: string;
  sentAt: string | null;
  products: CatalogSyncReply['products'];
  stock: CatalogSyncReply['stock'];
  deferred: CatalogSyncReply['deferred'];
}

const emptyProducts = (status: CatalogSyncPartStatus, received: number): CatalogSyncReply['products'] => ({
  status,
  received,
  applied: 0,
  unchanged: 0,
  skipped: {},
  trimmed: {},
  eco_proposed: 0,
  eco_kept: 0,
});

/**
 * Nhận MSS đẩy sang (kiến trúc A3 Pancake → MSS → Tubu): nội dung sản phẩm đã làm giàu theo cờ `mss.catalog_enrichment_enabled`, tồn
 * Pancake thời gian thực theo cờ `mss.stock_sync_enabled`. Hai phần độc lập: cờ nào chưa có hiệu lực thì phần đó trả `disabled` và không
 * ghi gì, phần kia vẫn chạy. Lặp lại an toàn nhờ điều kiện trên dữ liệu, không nhờ bảng biên nhận: tài liệu cùng bản đếm là không đổi,
 * dòng tồn cùng số cùng mốc đọc ghi lại đúng giá trị cũ, dòng đọc trước số đã áp bị bỏ (`stale`).
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: MssCatalogService,
    private readonly health: MssHealthService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly systemConfig?: SystemConfigService,
  ) {}

  async receive(env: CatalogSyncEnvelope, now: Date = new Date()): Promise<CatalogSyncReply> {
    const reply: CatalogSyncReply = {
      ok: true,
      sync_id: env.syncId,
      products: emptyProducts('none', env.products.length),
      stock: {
        status: 'none',
        received: env.stock.length + env.invalidStock,
        applied: 0,
        invalid: env.invalidStock,
        skipped: {},
        out_of_stock: 0,
        back_in_stock: 0,
        restock_waiting: 0,
      },
      deferred: { bundles: env.bundles },
    };
    let error: string | null = null;
    try {
      if (env.products.length > 0) reply.products = await this.applyProducts(env.products);
      if (env.stock.length + env.invalidStock > 0) await this.applyStock(env, reply, now);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : 'lỗi không rõ';
      throw err;
    } finally {
      await this.saveState(env, reply, now, error).catch((err: unknown) => {
        this.logger.warn(`Không ghi được trạng thái lần MSS đẩy ${env.syncId}: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
      });
    }
    return reply;
  }

  private async applyProducts(items: readonly unknown[]): Promise<CatalogSyncReply['products']> {
    if (!(await this.catalog.effective())) return emptyProducts('disabled', items.length);
    const s = await this.catalog.applyPushed(items);
    return {
      status: 'applied',
      received: s.received,
      applied: s.applied,
      unchanged: s.unchanged,
      skipped: s.skipped,
      trimmed: s.trimmed,
      eco_proposed: s.ecoProposed ?? 0,
      eco_kept: s.ecoKept ?? 0,
    };
  }

  private async applyStock(env: CatalogSyncEnvelope, reply: CatalogSyncReply, now: Date): Promise<void> {
    if (!(await this.health.assertCapability('stockSync'))) {
      reply.stock.status = 'disabled';
      return;
    }
    const keepPositiveOnZero = await readKeepPositiveOnZero(this.systemConfig);
    const res = await applyMssStock(this.prisma, env.stock, { signedAt: env.signedAt, now }, { keepPositiveOnZero });
    if (keepPositiveOnZero) {
      this.logger.log(`${PANCAKE_IGNORE_ZERO_STOCK_KEY} bật: lần MSS đẩy ${env.syncId} giữ tồn của ${res.kept} biến thể Pancake báo 0 mà Tubu còn hàng.`);
    }
    reply.stock = {
      ...reply.stock,
      status: 'applied',
      applied: res.applied,
      skipped: res.skipped,
      out_of_stock: res.wentOut.length,
      back_in_stock: res.backIn.length,
    };
    if (res.wentOut.length + res.backIn.length > 0) this.invalidateListings();
    if (res.backIn.length > 0) {
      reply.stock.restock_waiting = await this.prisma.restockAlert.count({ where: { variationId: { in: res.backIn }, notifiedAt: null } });
      if (reply.stock.restock_waiting > 0) this.kickRestock(env.syncId);
    }
  }

  /**
   * Danh sách/Trang chủ nhớ thứ tự và khối tĩnh vài chục giây; biến thể vừa hết hoặc vừa về thì dựng lại ngay. Trang sản phẩm và giỏ đọc
   * tồn thẳng từ DB nên không cần. Lấy service lười qua ModuleRef vì import CatalogModule vào đây thành vòng (CatalogModule → … → MssModule).
   */
  private invalidateListings(): void {
    const steps: Array<[string, () => void]> = [
      ['CatalogService', () => this.moduleRef?.get(CatalogService, { strict: false }).invalidateCategoryCache()],
      ['HomeService', () => this.moduleRef?.get(HomeService, { strict: false }).invalidateStatic()],
    ];
    for (const [name, run] of steps) {
      try {
        run();
      } catch {
        this.logger.debug(`Không có ${name} để xoá bộ đệm; bộ đệm tự hết hạn.`);
      }
    }
  }

  /** Gọi sớm lượt báo hàng về, không chờ: MSS nhận trả lời ngay, lỗi chỉ ghi log vì cron mỗi phút vẫn gửi. */
  private kickRestock(syncId: string): void {
    let dispatcher: RestockAlertsDispatcher | undefined;
    try {
      dispatcher = this.moduleRef?.get(RestockAlertsDispatcher, { strict: false });
    } catch {
      return;
    }
    void dispatcher?.kick().catch((err: unknown) => {
      this.logger.warn(`Lượt báo hàng về sớm sau lần MSS đẩy ${syncId} lỗi, chờ cron: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    });
  }

  private async saveState(env: CatalogSyncEnvelope, reply: CatalogSyncReply, now: Date, error: string | null): Promise<void> {
    const parts = [reply.products.status, reply.stock.status];
    const status = error ? 'failed' : parts.includes('applied') ? (parts.includes('disabled') ? 'partial' : 'ok') : 'skipped';
    const stats: MssPushStats = {
      syncId: env.syncId,
      sentAt: env.sentAt?.toISOString() ?? null,
      products: reply.products,
      stock: reply.stock,
      deferred: reply.deferred,
    };
    const finished = new Date();
    const data = {
      lastRunAt: now,
      lastFinishedAt: finished,
      lastStatus: status,
      lastTrigger: 'push',
      lastStats: stats as unknown as Prisma.InputJsonValue,
      lastError: error,
      updatedAt: finished,
    };
    await this.prisma.mssCatalogSyncState.upsert({ where: { id: MSS_PUSH_STATE_ID }, create: { id: MSS_PUSH_STATE_ID, ...data }, update: data });
  }
}
