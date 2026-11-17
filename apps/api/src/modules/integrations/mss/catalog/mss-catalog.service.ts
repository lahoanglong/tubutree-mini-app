import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CatalogService } from '../../../catalog/catalog.service';
import { ImageRegistryStale } from '../../../catalog/image-registry-stale';
import { orderedImageUrls, type MssEnrichmentPayload } from '../../../catalog/mss-enrichment';
import { MssClient, MssRequestError } from '../mss.client';
import { MssHealthService } from '../mss-health.service';
import { parseMssProductDoc, payloadSha256, type MssDocIssue, type MssParsedDoc } from './mss-catalog-doc';
import { mssMediaHosts } from './mss-media';

/** Một dòng trạng thái kéo duy nhất trong `mss_catalog_sync_state`. */
export const MSS_CATALOG_STATE_ID = 'catalog';
/** Hợp đồng mục 1.2: lần kéo sau hỏi từ `server_time` của lần trước trừ lùi 60 giây. */
export const MSS_CATALOG_WATERMARK_OVERLAP_MS = 60_000;
export const MSS_CATALOG_PAGE_LIMIT = 200;
/** Trần số trang một lượt (200 × 100 = 20.000 tài liệu, gấp trăm lần catalog hiện có): MSS trả cursor vòng thì lượt vẫn dừng. */
export const MSS_CATALOG_MAX_PAGES = 100;
const LIST_TIMEOUT_MS = 15_000;
const CURSOR_RE = /^[A-Za-z0-9._~+/=-]{1,512}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type MssCatalogTrigger = 'cron' | 'full' | 'doorbell' | 'admin';
export type MssCatalogRunKind = 'incremental' | 'full' | 'ids';
export type MssCatalogSkipReason = 'invalid_doc' | 'no_pancake_id' | 'unknown_product' | 'stale_version' | 'not_found' | 'apply_failed';

export interface MssCatalogRunStats {
  kind: MssCatalogRunKind;
  pages: number;
  received: number;
  /** Ghi mới hoặc ghi đè (nội dung đổi). */
  applied: number;
  unchanged: number;
  skipped: Partial<Record<MssCatalogSkipReason, number>>;
  /** Phần bị gọt trong tài liệu vẫn được ghép (URL ngoài host, chuỗi dài, slug danh mục lạ…). */
  trimmed: Partial<Record<MssDocIssue | 'unknown_category_slug', number>>;
}

export type MssCatalogRunStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface MssCatalogRunResult {
  status: MssCatalogRunStatus;
  stats: MssCatalogRunStats;
  error: string | null;
}

interface ListPage {
  items: unknown[];
  nextCursor: string | null;
  serverTime: Date;
}

export interface MssApplyContext {
  mediaHosts: readonly string[];
  categories: ReadonlyMap<string, string>;
}

const emptyStats = (kind: MssCatalogRunKind): MssCatalogRunStats => ({ kind, pages: 0, received: 0, applied: 0, unchanged: 0, skipped: {}, trimmed: {} });

function bump<K extends string>(m: Partial<Record<K, number>>, k: K, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}

/** Thân `GET /catalog/products` (mục 1.2). Sai dạng thì null: cả lượt dừng, không đoán. */
export function parseListPage(json: unknown): ListPage | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.items)) return null;
  const cursor = o.next_cursor;
  if (cursor !== null && cursor !== undefined && (typeof cursor !== 'string' || !CURSOR_RE.test(cursor))) return null;
  const t = typeof o.server_time === 'string' ? Date.parse(o.server_time) : NaN;
  if (!Number.isFinite(t)) return null;
  return { items: o.items, nextCursor: typeof cursor === 'string' ? cursor : null, serverTime: new Date(t) };
}

/**
 * Bản đến có mới hơn bản đang lưu không (cùng luật với mệnh đề WHERE của câu upsert). Bản xuất bản: phiên bản lớn hơn, hoặc cùng phiên bản mà
 * `updated_at` muộn hơn. Bản gỡ (`unpublished`/`removed`) thường không mang `published_version` (đọc thành 0) nên xét theo `updated_at`:
 * gỡ sau lần xuất bản cuối thì thắng. Cột phiên bản giữ số lớn nhất từng thấy, nên bản xuất bản cũ đến muộn sau lần gỡ vẫn bị chặn.
 */
export function isNewerDoc(state: string, version: number, at: number, prevVersion: number, prevAt: number): boolean {
  if (version > prevVersion) return true;
  if (state !== 'published') return at > prevAt;
  return version === prevVersion && at > prevAt;
}

/** Cột rút gọn đi kèm payload (thẻ sản phẩm, bộ lọc danh mục, danh sách ảnh /img). */
export function enrichmentColumns(state: string, payload: MssEnrichmentPayload) {
  const images = payload.images === null ? null : orderedImageUrls(payload.images);
  const media =
    state === 'published'
      ? [...(images ?? []), ...(payload.videos ?? []).flatMap((v) => (v.posterUrl ? [v.url, v.posterUrl] : [v.url]))]
      : [];
  return {
    title: payload.title,
    imagesOverride: images !== null,
    coverImage: images?.[0] ?? null,
    categoryOverride: payload.categoryIds !== null,
    categoryIds: payload.categoryIds ?? [],
    mediaUrls: [...new Set(media)],
  };
}

/**
 * Kéo nội dung bổ sung đã xuất bản từ MSS và lưu vào `product_mss_enrichment` (không đụng cột của `products`). Chỉ chạy khi cờ
 * `mss.catalog_enrichment_enabled` bật, đủ biến MSS và MSS công bố năng lực `catalog.enrichment`. Ghép theo `pancake_product_id`
 * ↔ `products.pancakeId`; sản phẩm MSS có mà Tubu không có thì bỏ qua và đếm (không tạo sản phẩm khi nguồn SKU vẫn là Pancake).
 *
 * Không lùi phiên bản: câu upsert chỉ ghi khi (`published_version`, `updated_at`) mới hơn bản đang lưu, nên lượt kéo định kỳ và lượt
 * do chuông chạy chồng nhau (hai tiến trình) thì bản mới hơn luôn thắng, bất kể lượt nào ghi sau.
 */
@Injectable()
export class MssCatalogService {
  private readonly logger = new Logger(MssCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MssClient,
    private readonly health: MssHealthService,
    @Optional() private readonly registryStale?: ImageRegistryStale,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /** Cờ có hiệu lực cho việc kéo (bật + đủ biến + MSS công bố năng lực). */
  effective(): Promise<boolean> {
    return this.health.assertCapability('catalogEnrichment');
  }

  /**
   * Một lượt kéo. `ids` là danh sách `pancake_product_id` (lượt do chuông); không có thì kéo theo mốc (`incremental`) hoặc toàn bộ
   * (`full`). Không ném vì lỗi MSS: lỗi được ghi vào dòng trạng thái và trả trong kết quả.
   */
  async run(kind: MssCatalogRunKind, trigger: MssCatalogTrigger, ids: readonly string[] = []): Promise<MssCatalogRunResult> {
    const stats = emptyStats(kind);
    if (!(await this.effective())) {
      return { status: 'skipped', stats, error: 'disabled' };
    }
    const startedAt = new Date();
    await this.prisma.mssCatalogSyncState.upsert({
      where: { id: MSS_CATALOG_STATE_ID },
      create: { id: MSS_CATALOG_STATE_ID, lastRunAt: startedAt, lastTrigger: trigger },
      update: { lastRunAt: startedAt, lastTrigger: trigger, updatedAt: startedAt },
    });
    const ctx: MssApplyContext = { mediaHosts: mssMediaHosts(), categories: await this.categoryIdsBySlug() };
    let watermark: Date | null = null;
    let error: string | null = null;
    try {
      if (kind === 'ids') {
        for (const id of ids) {
          if (!ID_RE.test(id)) continue;
          const doc = await this.fetchOne(id);
          if (doc === 'not_found') {
            bump(stats.skipped, 'not_found');
            continue;
          }
          stats.received += 1;
          await this.applyDocs([doc], stats, ctx);
        }
      } else {
        const state = kind === 'incremental' ? await this.prisma.mssCatalogSyncState.findUnique({ where: { id: MSS_CATALOG_STATE_ID }, select: { watermark: true } }) : null;
        const since = state?.watermark ? new Date(state.watermark.getTime() - MSS_CATALOG_WATERMARK_OVERLAP_MS) : null;
        let cursor: string | null = null;
        do {
          const page = await this.fetchPage(since, cursor);
          // Mốc của lượt = `server_time` của trang đầu: tài liệu đổi trong lúc đang lật trang sẽ được lượt sau hỏi lại.
          if (stats.pages === 0) watermark = page.serverTime;
          stats.pages += 1;
          stats.received += page.items.length;
          await this.applyDocs(page.items, stats, ctx);
          cursor = page.nextCursor;
        } while (cursor && stats.pages < MSS_CATALOG_MAX_PAGES);
        if (cursor) error = `Dừng ở ${MSS_CATALOG_MAX_PAGES} trang, còn trang sau`;
      }
    } catch (err) {
      error = err instanceof MssRequestError ? `${err.kind}${err.status ? ` HTTP ${err.status}` : ''}` : err instanceof Error ? err.message.slice(0, 300) : 'lỗi không rõ';
      this.logger.warn(`Kéo nội dung MSS (${kind}, ${trigger}) dừng: ${error}`);
    }
    const res: MssCatalogRunResult = { status: error ? (stats.received === 0 ? 'failed' : 'partial') : 'ok', stats, error };
    // Mốc chỉ tiến khi cả lượt xong: lượt dở dang (lỗi giữa chừng, chạm trần trang) giữ mốc cũ để lượt sau hỏi lại từ đó.
    await this.saveState(trigger, res, error ? null : watermark, kind === 'full' && !error);
    if (stats.applied > 0) this.invalidateCaches();
    return res;
  }

  private async saveState(trigger: MssCatalogTrigger, res: MssCatalogRunResult, watermark: Date | null, full: boolean): Promise<void> {
    const now = new Date();
    const data = {
      lastFinishedAt: now,
      lastStatus: res.status,
      lastTrigger: trigger,
      lastStats: res.stats as unknown as Prisma.InputJsonValue,
      lastError: res.error,
      updatedAt: now,
      ...(watermark ? { watermark } : {}),
      ...(full ? { lastFullAt: now } : {}),
    };
    await this.prisma.mssCatalogSyncState.upsert({ where: { id: MSS_CATALOG_STATE_ID }, create: { id: MSS_CATALOG_STATE_ID, ...data }, update: data });
  }

  private async fetchPage(since: Date | null, cursor: string | null): Promise<ListPage> {
    const qs = new URLSearchParams({ limit: String(MSS_CATALOG_PAGE_LIMIT) });
    if (since) qs.set('updated_after', since.toISOString());
    if (cursor) qs.set('cursor', cursor);
    const res = await this.client.request('GET', `/catalog/products?${qs.toString()}`, { op: 'GET catalog/products', timeoutMs: LIST_TIMEOUT_MS });
    const page = parseListPage(res.data);
    if (!page) throw new MssRequestError('invalid_response', 'Trang danh sách sản phẩm MSS sai dạng', { status: res.status });
    return page;
  }

  private async fetchOne(pancakeProductId: string): Promise<unknown> {
    try {
      const res = await this.client.request('GET', `/catalog/products/${encodeURIComponent(pancakeProductId)}`, { op: 'GET catalog/product' });
      return res.data;
    } catch (err) {
      if (err instanceof MssRequestError && err.status === 404) return 'not_found';
      throw err;
    }
  }

  private async categoryIdsBySlug(): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({ select: { id: true, slug: true } });
    return new Map(rows.map((c) => [c.slug.toLowerCase(), c.id]));
  }

  /** Ghép một lô tài liệu đã nhận (một trang hoặc một mã). */
  async applyDocs(items: readonly unknown[], stats: MssCatalogRunStats, ctx: MssApplyContext): Promise<void> {
    const docs: MssParsedDoc[] = [];
    for (const raw of items) {
      const parsed = parseMssProductDoc(raw, { mediaHosts: ctx.mediaHosts });
      if (!parsed.ok) {
        bump(stats.skipped, parsed.reason);
        continue;
      }
      for (const [k, n] of Object.entries(parsed.doc.issues)) bump(stats.trimmed, k as MssDocIssue, n);
      docs.push(parsed.doc);
    }
    if (docs.length === 0) return;
    const products = await this.prisma.product.findMany({ where: { pancakeId: { in: [...new Set(docs.map((d) => d.pancakeProductId))] } }, select: { id: true, pancakeId: true } });
    const productIdOf = new Map(products.map((p) => [p.pancakeId!, p.id]));
    const existing = await this.prisma.productMssEnrichment.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      select: { productId: true, contentVersion: true, mssUpdatedAt: true, sha256: true },
    });
    const current = new Map(existing.map((e) => [e.productId, e]));

    for (const doc of docs) {
      const productId = productIdOf.get(doc.pancakeProductId);
      if (!productId) {
        bump(stats.skipped, 'unknown_product');
        continue;
      }
      const payload = this.resolveCategories(doc, ctx.categories, stats);
      const sha = payloadSha256(doc.state, payload);
      const prev = current.get(productId);
      if (prev) {
        const prevAt = prev.mssUpdatedAt.getTime();
        const docAt = doc.updatedAt.getTime();
        if (prevAt === docAt && prev.sha256 === sha && (doc.state !== 'published' || prev.contentVersion === doc.version)) {
          stats.unchanged += 1;
          continue;
        }
        if (!isNewerDoc(doc.state, doc.version, docAt, prev.contentVersion, prevAt)) {
          bump(stats.skipped, 'stale_version');
          continue;
        }
      }
      try {
        const written = await this.upsert(productId, doc, payload, sha);
        if (written > 0) {
          stats.applied += 1;
          current.set(productId, { productId, contentVersion: Math.max(prev?.contentVersion ?? 0, doc.version), mssUpdatedAt: doc.updatedAt, sha256: sha });
        } else {
          bump(stats.skipped, 'stale_version');
        }
      } catch (err) {
        bump(stats.skipped, 'apply_failed');
        this.logger.warn(`Không ghi được nội dung MSS của sản phẩm ${productId}: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
      }
    }
  }

  /** `category_slugs` → id danh mục Tubu. Slug lạ bỏ và đếm; gửi slug mà không slug nào có ở Tubu thì giữ danh mục Tubu. */
  private resolveCategories(doc: MssParsedDoc, categories: ReadonlyMap<string, string>, stats: MssCatalogRunStats): MssEnrichmentPayload {
    if (doc.categorySlugs === null) return doc.payload;
    const ids: string[] = [];
    for (const slug of doc.categorySlugs) {
      const id = categories.get(slug);
      if (id) ids.push(id);
      else bump(stats.trimmed, 'unknown_category_slug');
    }
    const keep = doc.categorySlugs.length > 0 && ids.length === 0;
    return { ...doc.payload, categoryIds: keep ? null : ids };
  }

  /**
   * Một câu SQL: chèn, hoặc ghi đè chỉ khi bản đến mới hơn (phiên bản lớn hơn; cùng phiên bản thì `updated_at` muộn hơn; cùng cả hai
   * thì nội dung suy ra khác, ví dụ slug danh mục vừa có ở Tubu). Trả số dòng đã ghi (0 = bản đang lưu mới hơn, thua đua).
   */
  private upsert(productId: string, doc: MssParsedDoc, payload: MssEnrichmentPayload, sha: string): Promise<number> {
    const c = enrichmentColumns(doc.state, payload);
    // Cột là `timestamp` không múi giờ, Prisma đọc như UTC. Tham số Date của SQL thô đi dạng timestamptz và bị đổi theo TimeZone của phiên,
    // nên mốc giờ gửi bằng chuỗi ISO rồi quy về UTC ngay trong câu: máy chủ Postgres đặt giờ địa phương vẫn ghi đúng.
    const mssUpdatedAt = doc.updatedAt.toISOString();
    return this.prisma.$executeRaw`
      INSERT INTO "product_mss_enrichment" ("productId", "pancakeProductId", "mssProductId", "state", "payload", "contentVersion", "mssUpdatedAt",
        "fetchedAt", "sha256", "title", "imagesOverride", "coverImage", "categoryOverride", "categoryIds", "mediaUrls", "createdAt", "updatedAt")
      VALUES (${productId}, ${doc.pancakeProductId}, ${doc.mssProductId}, ${doc.state}, ${JSON.stringify(payload)}::jsonb, ${doc.version},
        (${mssUpdatedAt}::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), ${sha}, ${c.title}, ${c.imagesOverride}, ${c.coverImage},
        ${c.categoryOverride}, ${c.categoryIds}::text[], ${c.mediaUrls}::text[], (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("productId") DO UPDATE SET
        "pancakeProductId" = EXCLUDED."pancakeProductId", "mssProductId" = EXCLUDED."mssProductId", "state" = EXCLUDED."state",
        "payload" = EXCLUDED."payload", "contentVersion" = GREATEST("product_mss_enrichment"."contentVersion", EXCLUDED."contentVersion"),
        "mssUpdatedAt" = EXCLUDED."mssUpdatedAt",
        "fetchedAt" = EXCLUDED."fetchedAt", "sha256" = EXCLUDED."sha256", "title" = EXCLUDED."title", "imagesOverride" = EXCLUDED."imagesOverride",
        "coverImage" = EXCLUDED."coverImage", "categoryOverride" = EXCLUDED."categoryOverride", "categoryIds" = EXCLUDED."categoryIds",
        "mediaUrls" = EXCLUDED."mediaUrls", "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "product_mss_enrichment"."contentVersion" < EXCLUDED."contentVersion"
        OR ("product_mss_enrichment"."contentVersion" = EXCLUDED."contentVersion" AND "product_mss_enrichment"."mssUpdatedAt" < EXCLUDED."mssUpdatedAt")
        OR (EXCLUDED."state" <> 'published' AND "product_mss_enrichment"."mssUpdatedAt" < EXCLUDED."mssUpdatedAt")
        OR ("product_mss_enrichment"."contentVersion" = EXCLUDED."contentVersion" AND "product_mss_enrichment"."mssUpdatedAt" = EXCLUDED."mssUpdatedAt"
            AND "product_mss_enrichment"."sha256" <> EXCLUDED."sha256")`;
  }

  /**
   * Danh mục, thứ tự đã nhớ và danh sách ảnh /img đọc lại ngay. CatalogService lấy lười qua ModuleRef: import CatalogModule vào module
   * này sẽ thành vòng (CatalogModule → OrdersModule → … → MssModule).
   */
  private invalidateCaches(): void {
    this.registryStale?.markStale();
    try {
      this.moduleRef?.get(CatalogService, { strict: false }).invalidateCategoryCache();
    } catch {
      // Không có CatalogService (test, công cụ): bộ đệm 60 giây tự hết hạn.
    }
  }
}
