import { ConflictException, Inject, Injectable, Logger, Optional, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { recordCatalogRun, type CatalogRunResult } from '../../ops/ops-state';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { LifecycleService } from '../../lifecycle/lifecycle.service';
import { ImageRegistryStale } from '../../catalog/image-registry-stale';
import { applyPancakeStock, forcePancakeStock } from '../../catalog/variation-stock';
import type { PancakeProductDTO, PancakeProductsResponse, PancakeVariationDTO } from './pancake.types';
import { CRON_TZ } from '../../../common/cron-tz';
import { LEGACY_FAKE_PANCAKE_PREFIX } from './pancake-fulfilment';
import { pancakeProductSlug } from './pancake-product-slug';
import { payloadId, payloadNonNegInt, payloadQuantity, payloadRemoved, payloadText, payloadTextList } from './pancake-payload';
import { BROKEN_VARIANT_NAME_MARKER, isBrokenVariantName, variantAttributes, variantLabel } from './pancake-variant-fields';
import { CronLeaderService } from '../../../common/cron-leader/cron-leader.service';
import { RunLease } from '../../../common/cron-leader/run-lease';
import { SystemConfigService } from '../../system-config/system-config.service';
import {
  PANCAKE_CATEGORY_MAP_KEY,
  flattenPancakeCategories,
  mapPancakeCategories,
  pancakeCategoryRefs,
  type FlatPancakeCategory,
  type PancakeCategoryMap,
} from './pancake-category-map';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';

/** Lý do đồng bộ tự tắt (Variation/Product.pancakeHold). */
export const PANCAKE_HOLD = { REMOVED: 'REMOVED', NO_PRICE: 'NO_PRICE' } as const;
/**
 * Quét toàn bộ mà "biến mất" quá tỉ lệ này thì nhiều khả năng Pancake trả thiếu (lỗi phân trang, token
 * sai shop…) chứ không phải shop xoá hàng loạt — không tắt gì, chỉ log lỗi để người kiểm tra.
 */
const MAX_REMOVED_RATIO = 0.5;

/** Khoá chung (cron_leases) cho lượt đồng bộ danh mục: một lượt một lúc trên cả cụm, kể cả lượt admin bấm (R4-SYNC-6). */
export const CATALOG_SYNC_LEASE = 'pancake.catalog-sync';
/** Hạn khoá; lượt đồng bộ gia hạn mỗi trang. Process chết giữa lượt thì lượt sau chờ tối đa chừng này. */
const CATALOG_SYNC_LEASE_TTL_MS = 10 * 60_000;
export const CATALOG_SYNC_RUNNING = 'CATALOG_SYNC_RUNNING';

/** Một lượt đồng bộ danh mục đang chạy (trên replica này hay replica khác) — 409 để admin không đọc thành "đồng bộ 0 sản phẩm". */
export class CatalogSyncBusyError extends ConflictException {
  /** LOCAL: cờ `running` của chính tiến trình này (có thể là lượt treo); LEASE: replica khác giữ khoá. */
  constructor(readonly source: 'LOCAL' | 'LEASE' = 'LEASE') {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: CATALOG_SYNC_RUNNING,
      message:
        'Một lượt đồng bộ danh mục Pancake đang chạy — chưa chạy thêm lượt này. Đợi vài phút cho lượt kia xong rồi xem lại danh mục; ' +
        'cần đồng bộ lại thì bấm sau khi lượt kia xong.',
    });
  }
}

/** Cột Int của Postgres: giá/tồn lớn hơn làm câu ghi ném và hỏng cả sản phẩm. */
const INT4_MAX = 2_147_483_647;

/** Giá bán đọc được: số nguyên (hoặc chuỗi số kiểu máy) từ 1 tới trần cột Int; còn lại null — "không biết giá", không phải 0đ. */
const positivePrice = (x: unknown): number | null => {
  const n = payloadNonNegInt(x);
  return n !== null && n > 0 && n <= INT4_MAX ? n : null;
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Danh sách sản phẩm của một trang: mảng đầu tiên trong `data`/`products` (client đã bảo đảm ít nhất một trong hai là mảng). */
const pageProducts = (res: PancakeProductsResponse): unknown[] =>
  Array.isArray(res.data) ? res.data : Array.isArray(res.products) ? res.products : [];

/** Biến thể của sản phẩm: chỉ các phần tử là object; `variations` không phải mảng thì không có biến thể nào. */
const variationsOf = (p: PancakeProductDTO): PancakeVariationDTO[] =>
  Array.isArray(p.variations) ? (p.variations as unknown[]).filter(isRecord).map((v) => v as unknown as PancakeVariationDTO) : [];

interface SweepSeen {
  products: Set<string>;
  variations: Set<string>;
}

/** Pancake báo tổng số trang/bản ghi ở mỗi trang; lấy số lớn nhất từng thấy (danh mục có thể lớn lên giữa lượt). */
interface SweepExpected {
  pages?: number;
  entries?: number;
}

const nonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function noteExpected(exp: SweepExpected, res: PancakeProductsResponse): void {
  if (nonNegInt(res.total_pages)) exp.pages = Math.max(exp.pages ?? 0, res.total_pages);
  if (nonNegInt(res.total_entries)) exp.entries = Math.max(exp.entries ?? 0, res.total_entries);
}

/**
 * Đồng bộ catalog Pancake → Tubu (Build Spec §8.2).
 * - Sync ngay khi API khởi động (để catalog có sẵn, không chờ tới mốc cron) — chỉ trên instance giữ lease cron.
 * - Cron mỗi 15 phút lấy sản phẩm đã đổi (updated_since).
 * - KHÔNG overwrite các trường Tubu tự quản: brand, slug, forSegment, ingredients,
 *   certifications, SEO meta, isFeatured (chỉ set khi tạo mới).
 */
@Injectable()
export class PancakeSyncService implements OnModuleInit {
  private readonly logger = new Logger(PancakeSyncService.name);
  private lastRunAt: string | null = null;
  /** Chặn nhanh lượt chồng trên chính replica này; chặn giữa các replica là khoá chung CATALOG_SYNC_LEASE. */
  private running = false;
  private bootSyncStarted = false;
  /** Trần số trang — phòng trường hợp API bỏ qua tham số `page` và trả mãi cùng một trang. */
  private static readonly MAX_PAGES = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly lifecycle: LifecycleService,
    @Optional() private readonly cronLeader?: CronLeaderService,
    @Optional() private readonly systemConfig?: SystemConfigService,
    @Inject(ImageRegistryStale) private readonly imageStale?: ImageRegistryStale,
  ) {}

  /**
   * Danh mục Tubu hợp lệ để ánh xạ tới: chỉ danh mục lá (không là cha của danh mục nào), vì sản phẩm chỉ gán vào lá. Nhớ 60
   * giây để lượt đồng bộ hàng trăm sản phẩm không hỏi lại mỗi dòng.
   */
  private categoryIdsCache: { ids: Set<string>; at: number } | null = null;

  private async validCategoryIds(): Promise<Set<string>> {
    if (this.categoryIdsCache && Date.now() - this.categoryIdsCache.at < 60_000) return this.categoryIdsCache.ids;
    const rows = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
    const parents = new Set(rows.map((r) => r.parentId).filter((id): id is string => !!id));
    this.categoryIdsCache = { ids: new Set(rows.filter((r) => !parents.has(r.id)).map((r) => r.id)), at: Date.now() };
    return this.categoryIdsCache.ids;
  }

  /**
   * Danh mục Tubu cho sản phẩm mới/chưa có danh mục theo `pancake.category_map`. Lỗi đọc cấu hình/danh mục chỉ
   * bỏ qua việc ánh xạ (không chặn đồng bộ giá, tồn).
   */
  private async mappedCategoryIds(p: PancakeProductDTO): Promise<string[]> {
    if (!this.systemConfig || pancakeCategoryRefs(p).length === 0) return [];
    try {
      const map = await this.systemConfig.get<PancakeCategoryMap>(PANCAKE_CATEGORY_MAP_KEY, {});
      if (!map || Object.keys(map).length === 0) return [];
      return mapPancakeCategories(p, map, await this.validCategoryIds());
    } catch (e) {
      this.logger.warn(`Không ánh xạ được nhóm hàng Pancake cho ${p.id}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  /** Nhóm hàng Pancake kèm danh mục Tubu đã ánh xạ (màn "Danh mục sản phẩm" của admin). */
  async listPancakeCategories(): Promise<Array<FlatPancakeCategory & { mappedTo: string | null }>> {
    const flat = flattenPancakeCategories(await this.client.fetchCategories());
    const map = (await this.systemConfig?.get<PancakeCategoryMap>(PANCAKE_CATEGORY_MAP_KEY, {})) ?? {};
    const byKey = new Map(Object.entries(map).map(([k, v]) => [k.trim().toLowerCase(), v]));
    return flat.map((c) => ({ ...c, mappedTo: byKey.get(c.id.toLowerCase()) ?? byKey.get(c.name.trim().toLowerCase()) ?? null }));
  }

  /**
   * Sync lần đầu khi boot — không chặn khởi động, lỗi chỉ log.
   *
   * Cú quét này không có `updatedSince` nên đụng TOÀN BỘ catalog. Trước đây nó phải chạy ở chế
   * độ "không ghi tồn kho", vì ghi `stock` tuyệt đối mỗi lần restart/deploy là hồi sinh hàng vừa
   * bán hết (P0-3). Nay tồn kho đi qua `applyPancakeStock` — ghi theo chênh lệch và trừ phần
   * giữ chỗ — nên quét toàn bộ không còn nguy hiểm, và boot cũng cập nhật tồn kho như mọi lượt.
   *
   * Chỉ instance giữ lease cron mới quét: nhiều replica (scale, container cũ/mới chồng nhau lúc deploy) mà cùng quét
   * thì Pancake bị quét toàn bộ song song, và instance boot sau cùng gặp lỗi sẽ ghi đè trạng thái danh mục chung
   * (ops_health_states) thành báo động sai.
   */
  onModuleInit(): void {
    if (!this.client.isConfigured()) return;
    if (this.cronLeader) this.cronLeader.onLeadership(() => this.bootSync());
    else this.bootSync();
  }

  private bootSync(): void {
    if (this.bootSyncStarted) return;
    this.bootSyncStarted = true;
    void this.syncProducts().catch((e) => this.logFailure('Sync lúc khởi động', e));
  }

  /** Lượt tự động gặp lượt khác đang chạy là chuyện bình thường (boot chậm gặp mốc cron, admin vừa bấm) — chỉ cảnh báo. */
  private logFailure(what: string, err: unknown): void {
    if (err instanceof CatalogSyncBusyError) {
      // Cờ cục bộ kẹt phải đi qua phát hiện treo (chỉ áp dụng cho RUNNING); khoá của replica khác là bận thật.
      markCronSkipped(err.source === 'LOCAL' ? 'RUNNING' : 'BUSY');
      this.logger.warn(`${what}: một lượt đồng bộ danh mục khác đang chạy — bỏ qua lượt này.`);
      return;
    }
    this.logger.error(`${what} lỗi: ${err instanceof Error ? err.message : err}`);
  }

  @Cron('0 */15 * * * *', { timeZone: CRON_TZ }) // mỗi 15 phút
  @TrackCron({ alertAfter: 2 })
  async scheduledSync(): Promise<void> {
    if (!this.client.isConfigured()) { markCronSkipped('NOT_CONFIGURED'); return; } // dev: bỏ qua khi chưa có key
    // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — syncProducts() ném ra ngoài (Pancake
    // timeout, DB lỗi...) là unhandledRejection, Node 20 mặc định crash cả process. syncProducts()
    // tự nó vẫn được phép throw (pancake.controller gọi trực tiếp, cần biết khi lỗi để trả HTTP).
    try {
      await this.syncProducts(this.lastRunAt ?? undefined);
    } catch (err) {
      this.logFailure('scheduledSync', err);
    }
  }

  /** Quét toàn bộ mỗi đêm: lượt 15 phút theo updated_since không thấy được hàng đã bị xoá khỏi Pancake. */
  // Lệch khỏi lưới 15 phút của scheduledSync: cùng giây thì một bên luôn thua cờ `running` và bị bỏ qua.
  @Cron('0 37 3 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async nightlyFullSync(): Promise<void> {
    if (!this.client.isConfigured()) { markCronSkipped('NOT_CONFIGURED'); return; }
    try {
      await this.syncProducts();
    } catch (err) {
      // Quét đêm là lần duy nhất thấy hàng bị xoá khỏi Pancake: bị bỏ lỡ vì bận phải thành lỗi để có báo động, không phải bỏ qua êm.
      if (err instanceof CatalogSyncBusyError) {
        this.logger.error('Quét đêm danh mục Pancake không chạy được: một lượt đồng bộ khác đang chạy.');
        return;
      }
      this.logFailure('nightlyFullSync', err);
    }
  }

  /**
   * Đồng bộ toàn bộ (hoặc từ updatedSince). Trả số sản phẩm đã upsert.
   *
   * `opts.forceStock` — lối thoát CÓ CHỦ ĐÍCH cho admin: tin tuyệt đối số Pancake và xoá sạch
   * giữ chỗ. Chỉ dùng khi tồn kho local đã lệch thật; luồng tự động không bao giờ bật cờ này.
   *
   * Một lượt khác đang chạy (replica này hay replica khác) → CatalogSyncBusyError (409), không chạy chồng.
   */
  async syncProducts(
    updatedSince?: string,
    opts: { forceStock?: boolean } = {},
  ): Promise<number> {
    if (!this.client.isConfigured()) {
      this.logger.warn('Pancake chưa cấu hình — skip sync.');
      return 0;
    }
    if (this.running) throw new CatalogSyncBusyError('LOCAL');
    this.running = true;
    let lease: RunLease | null = null;
    try {
      lease = await RunLease.tryAcquire(this.prisma, CATALOG_SYNC_LEASE, CATALOG_SYNC_LEASE_TTL_MS);
      if (!lease) throw new CatalogSyncBusyError();
      return await this.sweep(lease, updatedSince, opts);
    } finally {
      // Cờ và khoá phải được nhả kể cả khi fetch ném — nếu không, một lần Pancake timeout là mọi lượt
      // sync sau đều bị chặn cho tới lần restart (cờ) hoặc tới khi khoá hết hạn.
      this.running = false;
      await lease?.release();
    }
  }

  private async sweep(lease: RunLease, updatedSince: string | undefined, opts: { forceStock?: boolean }): Promise<number> {
    // Mốc cursor lấy ở ĐẦU sync: sản phẩm đổi trong lúc sync sẽ được bắt ở lần kế
    // (upsert idempotent nên overlap nhẹ là an toàn — thà trùng còn hơn bỏ sót).
    const startedAt = new Date().toISOString();
    let page = 1;
    let count = 0;
    let failed = 0;
    let truncated = false;
    let pagesWithData = 0;
    let unnamedRows = 0;
    const expected: SweepExpected = {};
    const seen: SweepSeen = { products: new Set(), variations: new Set() };
    try {
      for (;;) {
      if (page > 1 && !(await lease.renew())) {
        // Khoá đã hết hạn (một trang chạy quá lâu) và lượt khác đã nhận: dừng để hai lượt không ghi chồng nhau.
        throw new ServiceUnavailableException(
          `Đồng bộ Pancake dừng ở trang ${page}: khoá đồng bộ đã sang một lượt khác (lượt này chạy quá lâu). ` +
            `Đã cập nhật ${count} sản phẩm; không tắt sản phẩm nào, lượt sau sẽ đọc lại.`,
        );
      }
      // Số tồn kho của trang này đúng tới lúc bắt đầu đọc (giờ máy chủ): webhook tồn kho NHẬN trước mốc này mà xử lý sau là số
      // lỗi thời. So bằng lúc nhận chứ không bằng updated_at Pancake — xem PancakeStockOrigin.
      const stockReadAt = new Date();
      const res = await this.client.fetchProducts(page, updatedSince);
      noteExpected(expected, res);
      const products = pageProducts(res);
      if (products.length === 0) break;
      pagesWithData++;
      for (const row of products) {
        // Phần tử không phải object (null, chuỗi...) là dữ liệu hỏng của Pancake: đọc `.id` của nó ném TypeError và làm chết cả lượt,
        // mà lượt 15 phút sau gặp lại đúng nó. Tính như một hàng không mã để so với total_entries vẫn khớp.
        if (!isRecord(row)) {
          unnamedRows++;
          failed++;
          this.logger.error(`Bỏ qua phần tử không phải sản phẩm ở trang ${page} của Pancake: ${JSON.stringify(row) ?? String(row)}`.slice(0, 200));
          continue;
        }
        const p = row as unknown as PancakeProductDTO;
        const pid = payloadId(p.id) ?? payloadId(p.product_id);
        if (pid) seen.products.add(pid);
        else unnamedRows++;
        for (const v of variationsOf(p)) {
          const vid = payloadId(v.id);
          if (vid) seen.variations.add(vid);
        }
        // Cô lập lỗi từng sản phẩm — 1 SP hỏng (vd slug trùng) không làm hỏng cả batch.
        try {
          if (await this.upsertProduct(p, { ...opts, stockReadAt })) count++;
          else failed++;
        } catch (err) {
          failed++;
          this.logger.error(`Upsert sản phẩm Pancake ${pid ?? '?'} lỗi: ${err instanceof Error ? err.message : err}`);
        }
      }
      page++;
      // Dừng khi trang rỗng (kiểm ở đầu vòng), KHÔNG đoán theo page size: trước đây dừng ngay
      // khi một trang trả < 20 bản ghi, nên nếu Pancake đặt page size 10 thì mọi trang đều
      // "ngắn" và đồng bộ im lặng dừng sau trang đầu — log vẫn báo thành công.
      if (page > PancakeSyncService.MAX_PAGES) {
        this.logger.error(`Dừng sync ở trang ${page}: vượt trần ${PancakeSyncService.MAX_PAGES} trang.`);
        truncated = true;
        break;
      }
      }
      const got = seen.products.size + unnamedRows;
      if (
        truncated ||
        (expected.pages !== undefined && pagesWithData < expected.pages) ||
        (expected.entries !== undefined && got < expected.entries)
      ) {
        // Không dời lastRunAt: lượt 15 phút sau phải đọc lại từ mốc cũ, không bỏ sót các trang chưa tới.
        throw new ServiceUnavailableException(
          `Đồng bộ Pancake dừng khi chưa hết danh mục: đọc ${pagesWithData}/${expected.pages ?? '?'} trang, ` +
            `${got}/${expected.entries ?? '?'} sản phẩm (đã cập nhật ${count}). Không tắt sản phẩm nào; lượt sau sẽ thử lại.`,
        );
      }
      if (!updatedSince) {
        if (expected.pages === undefined && expected.entries === undefined) {
          this.logger.error(
            'Pancake không trả total_pages/total_entries — không chứng minh được đã quét hết danh mục, bỏ qua bước ngừng bán hàng đã xoá.',
          );
        } else {
          await this.deactivateMissing(seen);
        }
      }
      this.lastRunAt = startedAt;
      this.logger.log(`Đã đồng bộ ${count} sản phẩm từ Pancake${failed ? ` (${failed} lỗi, bỏ qua)` : ''}.`);
      await this.noteRun({ ok: true, count, failed });
      return count;
    } catch (err) {
      await this.noteRun({ ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Lượt đồng bộ vào màn sức khoẻ vận hành — best-effort: ghi lỗi không được làm hỏng/che lỗi của lượt đồng bộ. */
  private async noteRun(run: CatalogRunResult): Promise<void> {
    try {
      await recordCatalogRun(this.prisma, run);
    } catch (e) {
      this.logger.warn(`Không ghi được trạng thái đồng bộ danh mục: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Chỉ quét TOÀN BỘ mới biết thứ gì đã biến khỏi Pancake (lượt 15 phút lấy theo updated_since). SP/biến
   * thể có trên Tubu (trừ hàng merchant) mà Pancake không còn trả → ngừng bán, ghi pancakeHold=REMOVED để
   * lần sau Pancake trả lại thì tự bật lại. Thứ đã bị admin tắt tay (pancakeHold NULL) không bị đụng.
   */
  private async deactivateMissing(seen: SweepSeen): Promise<void> {
    if (seen.variations.size === 0 && seen.products.size === 0) {
      this.logger.error('Quét toàn bộ Pancake trả 0 sản phẩm — không tắt gì (nghi Pancake trả thiếu).');
      return;
    }
    // Hàng không có mã Pancake (đối tác tự giao, sản phẩm đối tác "Tubu giao hộ" mà biến thể mới mang mã) không thuộc
    // danh mục Pancake — quét toàn bộ không được đụng.
    const onPancake = {
      pancakeId: { not: null },
      NOT: { pancakeId: { startsWith: LEGACY_FAKE_PANCAKE_PREFIX } },
    } satisfies Prisma.VariationWhereInput & Prisma.ProductWhereInput;
    const [vars, prods] = await Promise.all([
      this.prisma.variation.findMany({ where: { isActive: true, ...onPancake }, select: { id: true, pancakeId: true } }),
      this.prisma.product.findMany({ where: { isActive: true, ...onPancake }, select: { id: true, pancakeId: true } }),
    ]);
    const goneVars = vars.filter((v) => v.pancakeId !== null && !seen.variations.has(v.pancakeId));
    const goneProds = prods.filter((p) => p.pancakeId !== null && !seen.products.has(p.pancakeId));
    if (goneVars.length === 0 && goneProds.length === 0) return;
    if (goneVars.length > vars.length * MAX_REMOVED_RATIO || goneProds.length > prods.length * MAX_REMOVED_RATIO) {
      this.logger.error(
        `Quét toàn bộ: ${goneVars.length}/${vars.length} biến thể và ${goneProds.length}/${prods.length} sản phẩm không còn trên Pancake — ` +
          'vượt ngưỡng an toàn, KHÔNG tự tắt. Kiểm tra kết nối/danh mục Pancake rồi tắt tay nếu đúng.',
      );
      return;
    }
    const hold = { isActive: false, pancakeHold: PANCAKE_HOLD.REMOVED };
    if (goneVars.length)
      await this.prisma.variation.updateMany({ where: { id: { in: goneVars.map((v) => v.id) }, isActive: true }, data: hold });
    if (goneProds.length)
      await this.prisma.product.updateMany({ where: { id: { in: goneProds.map((p) => p.id) }, isActive: true }, data: hold });
    this.logger.warn(
      `Ngừng bán vì không còn trên Pancake: ${goneProds.length} sản phẩm [${goneProds.map((p) => p.pancakeId).join(', ')}], ` +
        `${goneVars.length} biến thể [${goneVars.map((v) => v.pancakeId).join(', ')}].`,
    );
  }

  /**
   * Bật/tắt theo Pancake mà không giành quyền của admin: chỉ tắt thứ đang bán hoặc đang do đồng bộ giữ, chỉ
   * bật lại thứ chính đồng bộ đã tắt.
   */
  private holdPatch(
    prev: { isActive: boolean; pancakeHold: string | null } | null,
    want: string | null,
  ): { isActive?: boolean; pancakeHold?: string | null } {
    const syncOwned = !prev || prev.isActive || prev.pancakeHold != null;
    if (want) return syncOwned && prev?.pancakeHold !== want ? { isActive: false, pancakeHold: want } : {};
    return prev?.pancakeHold != null ? { isActive: true, pancakeHold: null } : {};
  }

  private variationPrices(
    v: PancakeVariationDTO,
    prev: { retailPrice: number; pancakeHold: string | null } | null,
  ): { prices: { retailPrice?: number; salePrice?: number | null }; noPrice: boolean } {
    const retail = positivePrice(v.retail_price);
    if (retail !== null) return { prices: { retailPrice: retail, salePrice: positivePrice(v.sale_price) }, noPrice: false };
    this.logger.warn(
      `Biến thể Pancake ${v.id} thiếu/không hợp lệ retail_price (${JSON.stringify(v.retail_price) ?? 'undefined'}) — ` +
        (prev && prev.retailPrice > 0 ? `giữ giá cũ ${prev.retailPrice}.` : 'không mở bán tới khi có giá.'),
    );
    return { prices: {}, noPrice: !prev || prev.retailPrice <= 0 || prev.pancakeHold === PANCAKE_HOLD.NO_PRICE };
  }

  /** `false` = bỏ qua vì thiếu mã/tên đọc được (dữ liệu hỏng của Pancake), không ghi gì. */
  private async upsertProduct(p: PancakeProductDTO, opts: { forceStock?: boolean; stockReadAt?: Date } = {}): Promise<boolean> {
    // Pancake POS dùng `id` cho sản phẩm (product_id là của variation) — lấy id thật.
    const pancakeId = payloadId(p.id) ?? payloadId(p.product_id);
    const name = payloadText(p.name);
    if (!pancakeId || !name) {
      this.logger.warn(`Bỏ qua sản phẩm Pancake thiếu id/name: ${JSON.stringify(p)?.slice(0, 120)}`);
      return false;
    }
    const variations = variationsOf(p);
    const existing = await this.prisma.product.findUnique({ where: { pancakeId } });

    // Ảnh: ưu tiên ảnh sản phẩm, rồi ảnh variation đầu tiên (Pancake hay để ảnh ở variation).
    const imgs = [
      ...payloadTextList(p.images),
      ...payloadTextList(p.image),
      ...variations.flatMap((v) => payloadTextList(v.images)),
    ];

    const description = typeof p.description === 'string' && p.description.trim() ? p.description : null;
    const sellable = variations.filter((v) => !payloadRemoved(v.is_removed) && positivePrice(v.retail_price) !== null);
    const baseData = {
      name,
      // Mô tả Pancake để trống không xoá mô tả admin đã nhập ở trang quản trị; có nội dung thật thì Pancake là nguồn chính.
      description: description ?? existing?.description ?? '',
      images: imgs.length ? imgs : (existing?.images ?? []),
      thumbnail: imgs[0] ?? existing?.thumbnail ?? null,
      basePrice: positivePrice(sellable[0]?.retail_price) ?? existing?.basePrice ?? 0,
    };
    // Chưa biến thể nào có giá (và sản phẩm chưa từng bán có giá) → chưa mở bán, kẻo hiện "0đ" ngoài danh mục.
    // Sản phẩm đang bán mà Pancake tạm trả thiếu giá thì giữ bán theo giá cũ như biến thể (variationPrices).
    const priced = sellable.length > 0;
    const soldBefore = !!existing && existing.basePrice > 0 && existing.pancakeHold !== PANCAKE_HOLD.NO_PRICE;
    const productHold = this.holdPatch(
      existing,
      payloadRemoved(p.is_removed) ? PANCAKE_HOLD.REMOVED : !priced && !soldBefore ? PANCAKE_HOLD.NO_PRICE : null,
    );

    // forSegment: suy từ tên để segment pills (Cho mẹ&bé / Nhà bếp xanh / Chăm sóc cá nhân / Sống xanh)
    // có hàng. Chỉ set khi tạo mới hoặc khi product cũ CHƯA có segment (không đè tag thủ công).
    const inferred = this.inferSegments(name);
    // Danh mục: admin gán tay là của admin — đồng bộ chỉ điền khi sản phẩm CHƯA có danh mục nào.
    const mappedCats = (existing?.categoryIds?.length ?? 0) === 0 ? await this.mappedCategoryIds(p) : [];

    // Chỉ đánh dấu khi ảnh thật sự đổi, và đánh dấu SAU khi ghi xong: đánh dấu trước thì một /img xen giữa nạp lại, xoá cờ mà DB
    // chưa thấy ảnh mới. Có /img xen giữa thì một lượt đồng bộ có thể gây vài lần nạp nối tiếp, mỗi lần một truy vấn rẻ.
    const imagesChanged = !existing || baseData.thumbnail !== (existing.thumbnail ?? null) || JSON.stringify(baseData.images) !== JSON.stringify(existing.images ?? []);

    const product = existing
      ? await this.prisma.product.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...productHold,
            ...((existing.forSegment?.length ?? 0) === 0 ? { forSegment: inferred } : {}),
          },
        })
      : await this.prisma.product.create({
          data: {
            ...baseData,
            ...productHold,
            pancakeId,
            brand: 'Tubu Tree',
            slug: this.slugify(name, pancakeId),
            forSegment: inferred,
            categoryIds: mappedCats,
          },
        });
    if (imagesChanged) this.imageStale?.markStale();

    // Điền danh mục bằng lệnh có điều kiện "vẫn còn rỗng", tách khỏi update ở trên: `existing` đọc từ trước, nếu admin vừa gán
    // tay trong khoảng đó thì lệnh này không khớp dòng nào và danh mục của admin còn nguyên.
    if (existing && mappedCats.length) {
      await this.prisma.product.updateMany({ where: { id: existing.id, categoryIds: { isEmpty: true } }, data: { categoryIds: mappedCats } });
    }

    // Biến thể giảm sâu nhất theo % — giá cũ/mới của nó đi vào nội dung thông báo và để xét ngưỡng giảm tối thiểu.
    let bestDrop: { oldPrice: number; newPrice: number } | null = null;
    // Cô lập lỗi từng biến thể như từng sản phẩm: một biến thể hỏng (sku trùng, mã rác) không được chặn các biến thể còn lại của cùng
    // sản phẩm cập nhật giá/tồn. Lỗi đầu tiên ném sau cùng để sản phẩm vẫn được tính là lỗi trong lượt.
    let variationError: unknown = null;
    for (const v of variations) {
      const vid = payloadId(v.id);
      if (!vid) {
        this.logger.warn(`Bỏ qua biến thể Pancake không có mã đọc được của sản phẩm ${pancakeId}: ${JSON.stringify(v.id) ?? 'undefined'}`);
        continue;
      }
      try {
        const drop = await this.upsertVariation(v, vid, product.id, name, opts);
        if (drop && (!bestDrop || (drop.oldPrice - drop.newPrice) / drop.oldPrice > (bestDrop.oldPrice - bestDrop.newPrice) / bestDrop.oldPrice)) {
          bestDrop = drop;
        }
      } catch (err) {
        variationError ??= err;
        this.logger.error(`Upsert biến thể Pancake ${vid} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Giá giảm → báo cho user đã wishlist (không chặn sync nếu notify lỗi).
    if (bestDrop) {
      await this.lifecycle.notifyWishlistPriceDrop(product.id, product.name, bestDrop).catch(() => undefined);
    }
    if (variationError) throw variationError;
    return true;
  }

  /** Ghi một biến thể; trả mức giảm giá của nó (so với giá đang lưu) nếu khách mua được và giá giảm. */
  private async upsertVariation(
    v: PancakeVariationDTO,
    vid: string,
    productId: string,
    productName: string,
    opts: { forceStock?: boolean; stockReadAt?: Date },
  ): Promise<{ oldPrice: number; newPrice: number } | null> {
    let drop: { oldPrice: number; newPrice: number } | null = null;
    // So giá cũ ↔ mới để phát hiện GIẢM GIÁ (§6.14.10 Price Drop Alert).
    const prev = await this.prisma.variation.findUnique({
      where: { pancakeId: vid },
      select: { retailPrice: true, salePrice: true, isActive: true, pancakeHold: true, name: true },
    });
    const removed = payloadRemoved(v.is_removed);
    const { prices, noPrice } = this.variationPrices(v, prev);
    const hold = this.holdPatch(prev, removed ? PANCAKE_HOLD.REMOVED : noPrice ? PANCAKE_HOLD.NO_PRICE : null);
    // Biến thể khách không mua được sau lượt này (Pancake xoá, hoặc admin đã tắt bán) hạ giá thì không báo "giảm giá".
    const sellable = !removed && (hold.isActive ?? prev?.isActive) !== false;
    if (prev && sellable && prices.retailPrice != null) {
      const newEff = prices.salePrice ?? prices.retailPrice;
      const oldEff = prev.salePrice ?? prev.retailPrice;
      if (newEff > 0 && newEff < oldEff) drop = { oldPrice: oldEff, newPrice: newEff };
    }
    // Cột `sku` là khoá duy nhất: ghi nguyên văn chuỗi Pancake gửi (không cắt khoảng trắng, kẻo lệch so với các lần đồng bộ trước và
    // với sku admin đã dán); rỗng/khoảng trắng/object lấy mã biến thể, số đổi thành chuỗi.
    const sku = typeof v.sku === 'string' ? (v.sku.trim() ? v.sku : vid) : (payloadText(v.sku) ?? vid);
    // Cột `weight` là Int: số lẻ làm Prisma ném và hỏng cả sản phẩm; số âm/rác là không biết.
    const weight = payloadNonNegInt(v.weight, { round: true });
    const label = variantLabel(v.fields) ?? productName;
    // `remain_quantity` vắng mặt hoặc không đọc được = Pancake KHÔNG nói gì về tồn kho lần này (không phải "hết hàng").
    // Số âm (POS cho bán lố kho) là hết hàng: tồn bán được không âm.
    const reported = payloadQuantity(v.remain_quantity);
    const remain = reported === null ? null : Math.max(0, reported);
    if (v.remain_quantity != null && reported === null) {
      this.logger.warn(`Biến thể Pancake ${vid} có remain_quantity không đọc được (${JSON.stringify(v.remain_quantity)}) — không đổi tồn kho.`);
    }
    await this.prisma.variation.upsert({
      where: { pancakeId: vid },
      update: {
        sku,
        attributes: variantAttributes(v.fields),
        ...prices,
        ...hold,
        weight,
        // KHÔNG ghi `stock` ở đây: tồn kho đi qua applyPancakeStock ngay dưới, vì nó phải đọc
        // giá trị cũ của chính hàng đó (chênh lệch + giữ chỗ) trong MỘT câu UPDATE nguyên tử.
      },
      create: {
        pancakeId: vid,
        productId,
        sku,
        name: label,
        attributes: variantAttributes(v.fields),
        retailPrice: prices.retailPrice ?? 0,
        salePrice: prices.salePrice ?? null,
        ...hold,
        stock: remain ?? 0,
        pancakeStock: remain ?? 0,
        weight,
      },
    });
    // Tên chỉ ghi lúc tạo, nên dòng đã ghi hỏng thì lành ở đây. Câu UPDATE tự kiểm lại tên VẪN còn dấu hiệu hỏng: admin sửa
    // tay giữa lúc đọc `prev` và lúc này thì không bị đè.
    if (isBrokenVariantName(prev?.name)) {
      await this.prisma.variation.updateMany({
        where: { pancakeId: vid, name: { contains: BROKEN_VARIANT_NAME_MARKER } },
        data: { name: label },
      });
    }
    // Kèm lúc đọc: webhook nhận sau lúc đọc đã áp trong lúc lượt này chạy thì số đọc trước đó không ghi đè (R5-SYNC-3).
    if (remain !== null) {
      const readAt = opts.stockReadAt;
      if (opts.forceStock) await forcePancakeStock(this.prisma, vid, remain, { readAt });
      else await applyPancakeStock(this.prisma, vid, remain, readAt && { kind: 'sync', readAt });
    }
    return drop;
  }

  private slugify(name: string, suffix: string): string {
    return pancakeProductSlug(name, suffix);
  }

  /** Suy phân khúc từ tên sản phẩm (bỏ dấu) — eco là catch-all để "Sống xanh" luôn có hàng. */
  private inferSegments(name: string): string[] {
    const n = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd');
    const segs = new Set<string>(['eco']); // mọi sản phẩm Tubu đều "sống xanh"
    if (/\b(be|em be|tre em|baby|ta |bim|tre nho)\b|cho be|tre/.test(n)) segs.add('mom_baby');
    if (/rua chen|lau san|nuoc rua|nuoc giat|giat|tay rua|lau kinh|ve sinh|rua tay|xa phong|nuoc lau/.test(n))
      segs.add('home_clean');
    if (/dau goi|sua tam|serum|kem |duong|mat na|rua mat|tinh dau|nuoc hoa hong|son |dau xa|cham soc/.test(n))
      segs.add('skincare');
    return [...segs];
  }
}
