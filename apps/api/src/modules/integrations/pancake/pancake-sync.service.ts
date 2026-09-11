import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { LifecycleService } from '../../lifecycle/lifecycle.service';
import type { PancakeProductDTO } from './pancake.types';

/**
 * Đồng bộ catalog Pancake → Tubu (Build Spec §8.2).
 * - Sync ngay khi API khởi động (để catalog có sẵn, không chờ tới mốc cron).
 * - Cron mỗi 15 phút lấy sản phẩm đã đổi (updated_since).
 * - KHÔNG overwrite các trường Tubu tự quản: brand, slug, forSegment, ingredients,
 *   certifications, SEO meta, isFeatured (chỉ set khi tạo mới).
 */
@Injectable()
export class PancakeSyncService implements OnModuleInit {
  private readonly logger = new Logger(PancakeSyncService.name);
  private lastRunAt: string | null = null;
  /** Chặn hai lượt sync chạy chồng lên nhau (boot sync chậm gặp đúng mốc cron 15 phút). */
  private running = false;
  /** Trần số trang — phòng trường hợp API bỏ qua tham số `page` và trả mãi cùng một trang. */
  private static readonly MAX_PAGES = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly lifecycle: LifecycleService,
  ) {}

  /**
   * Sync lần đầu khi boot — không chặn khởi động, lỗi chỉ log.
   * `skipStock`: cú quét này KHÔNG có `updatedSince` nên đụng vào TOÀN BỘ catalog. Nếu để nó
   * ghi đè `stock`, mỗi lần restart/deploy là đặt lại tồn kho của mọi sản phẩm theo số Pancake
   * — kể cả khi đơn cục bộ vừa trừ kho mà Pancake chưa phản ánh → hồi sinh hàng đã bán hết
   * (P0-3, docs/2026-09-08-review-progress.md). Giá/metadata vẫn đồng bộ bình thường; tồn kho
   * để cho cú sync tăng dần 15 phút (phạm vi hẹp) và webhook lo.
   */
  onModuleInit(): void {
    if (!this.client.isConfigured()) return;
    void this.syncProducts(undefined, { skipStock: true }).catch((e) =>
      this.logger.error(`Sync lúc khởi động lỗi: ${e instanceof Error ? e.message : e}`),
    );
  }

  @Cron('0 */15 * * * *') // mỗi 15 phút
  async scheduledSync(): Promise<void> {
    if (!this.client.isConfigured()) return; // dev: bỏ qua khi chưa có key
    await this.syncProducts(this.lastRunAt ?? undefined);
  }

  /**
   * Đồng bộ toàn bộ (hoặc từ updatedSince). Trả số sản phẩm đã upsert.
   * `opts.skipStock` — không ghi đè cột `stock` của variation ĐÃ TỒN TẠI (variation mới vẫn
   * lấy tồn kho ban đầu từ Pancake vì chưa thể có đơn cục bộ nào). Xem onModuleInit.
   */
  async syncProducts(updatedSince?: string, opts: { skipStock?: boolean } = {}): Promise<number> {
    if (!this.client.isConfigured()) {
      this.logger.warn('Pancake chưa cấu hình — skip sync.');
      return 0;
    }
    if (this.running) {
      this.logger.warn('Một lượt sync đang chạy — bỏ qua lượt này để hai lượt không ghi đè nhau.');
      return 0;
    }
    // An toàn tồn kho buộc theo PHẠM VI QUÉT, không theo ý caller: không có `updatedSince`
    // nghĩa là đụng TOÀN BỘ catalog, và lúc đó không được ghi `stock`. Trước đây chỉ boot sync
    // tự truyền skipStock, nên `lastRunAt` (chỉ nằm trong RAM) còn null — boot sync lỗi, hoặc
    // process vừa khởi động lại — là cron 15 phút quét toàn bộ VÀ ghi đè tồn kho của mọi sản
    // phẩm theo số Pancake, hồi sinh hàng vừa bán hết cục bộ.
    const skipStock = opts.skipStock || updatedSince === undefined;
    this.running = true;
    // Mốc cursor lấy ở ĐẦU sync: sản phẩm đổi trong lúc sync sẽ được bắt ở lần kế
    // (upsert idempotent nên overlap nhẹ là an toàn — thà trùng còn hơn bỏ sót).
    const startedAt = new Date().toISOString();
    let page = 1;
    let count = 0;
    let failed = 0;
    try {
      for (;;) {
      const res = await this.client.fetchProducts(page, updatedSince);
      const products = res.data ?? res.products ?? [];
      if (products.length === 0) break;
      for (const p of products) {
        // Cô lập lỗi từng sản phẩm — 1 SP hỏng (vd slug trùng) không làm hỏng cả batch.
        try {
          await this.upsertProduct(p, { ...opts, skipStock });
          count++;
        } catch (err) {
          failed++;
          this.logger.error(
            `Upsert sản phẩm Pancake ${p.product_id} lỗi: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      page++;
      // Dừng khi trang rỗng (kiểm ở đầu vòng), KHÔNG đoán theo page size: trước đây dừng ngay
      // khi một trang trả < 20 bản ghi, nên nếu Pancake đặt page size 10 thì mọi trang đều
      // "ngắn" và đồng bộ im lặng dừng sau trang đầu — log vẫn báo thành công.
      if (page > PancakeSyncService.MAX_PAGES) {
        this.logger.error(`Dừng sync ở trang ${page}: vượt trần ${PancakeSyncService.MAX_PAGES} trang.`);
        break;
      }
      }
      this.lastRunAt = startedAt;
      this.logger.log(`Đã đồng bộ ${count} sản phẩm từ Pancake${failed ? ` (${failed} lỗi, bỏ qua)` : ''}.`);
      return count;
    } finally {
      // Cờ phải được nhả kể cả khi fetch ném — nếu không, một lần Pancake timeout là mọi lượt
      // sync sau đều bị chính cờ này chặn cho tới lần restart.
      this.running = false;
    }
  }

  private async upsertProduct(p: PancakeProductDTO, opts: { skipStock?: boolean } = {}): Promise<void> {
    // Pancake POS dùng `id` cho sản phẩm (product_id là của variation) — lấy id thật.
    const pancakeId = p.id ?? p.product_id;
    if (!pancakeId || !p.name) {
      this.logger.warn(`Bỏ qua sản phẩm Pancake thiếu id/name: ${JSON.stringify(p).slice(0, 120)}`);
      return;
    }
    const existing = await this.prisma.product.findUnique({ where: { pancakeId } });

    // Ảnh: ưu tiên ảnh sản phẩm, rồi ảnh variation đầu tiên (Pancake hay để ảnh ở variation).
    const imgs = [
      ...(p.images ?? []),
      ...(p.image ? [p.image] : []),
      ...(p.variations?.flatMap((v) => v.images ?? []) ?? []),
    ].filter((u): u is string => typeof u === 'string' && u.length > 0);

    const baseData = {
      name: p.name,
      description: p.description ?? existing?.description ?? '',
      images: imgs.length ? imgs : (existing?.images ?? []),
      thumbnail: imgs[0] ?? existing?.thumbnail ?? null,
      basePrice: p.variations?.[0]?.retail_price ?? existing?.basePrice ?? 0,
    };

    // forSegment: suy từ tên để segment pills (Cho mẹ&bé / Nhà bếp xanh / Chăm sóc cá nhân / Sống xanh)
    // có hàng. Chỉ set khi tạo mới hoặc khi product cũ CHƯA có segment (không đè tag thủ công).
    const inferred = this.inferSegments(p.name);

    const product = existing
      ? await this.prisma.product.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...((existing.forSegment?.length ?? 0) === 0 ? { forSegment: inferred } : {}),
          },
        })
      : await this.prisma.product.create({
          data: {
            ...baseData,
            pancakeId,
            brand: 'Tubu Tree',
            slug: this.slugify(p.name, pancakeId),
            forSegment: inferred,
          },
        });

    let priceDropped = false;
    for (const v of p.variations ?? []) {
      // So giá cũ ↔ mới để phát hiện GIẢM GIÁ (§6.14.10 Price Drop Alert).
      const prev = await this.prisma.variation.findUnique({
        where: { pancakeId: v.id },
        select: { retailPrice: true, salePrice: true },
      });
      const newEff = v.sale_price ?? v.retail_price ?? 0;
      if (prev) {
        const oldEff = prev.salePrice ?? prev.retailPrice;
        if (newEff > 0 && newEff < oldEff) priceDropped = true;
      }
      await this.prisma.variation.upsert({
        where: { pancakeId: v.id },
        update: {
          sku: v.sku ?? v.id,
          attributes: v.fields ?? {},
          retailPrice: v.retail_price ?? 0,
          salePrice: v.sale_price ?? null,
          // Chỉ ghi tồn kho khi KHÔNG ở chế độ skipStock (xem onModuleInit).
          ...(opts.skipStock ? {} : { stock: v.remain_quantity ?? 0 }),
          weight: v.weight ?? null,
        },
        create: {
          pancakeId: v.id,
          productId: product.id,
          sku: v.sku ?? v.id,
          name: v.fields ? Object.values(v.fields).join(' - ') : p.name,
          attributes: v.fields ?? {},
          retailPrice: v.retail_price ?? 0,
          salePrice: v.sale_price ?? null,
          stock: v.remain_quantity ?? 0,
          weight: v.weight ?? null,
        },
      });
    }

    // Giá giảm → báo cho user đã wishlist (không chặn sync nếu notify lỗi).
    if (priceDropped) {
      await this.lifecycle.notifyWishlistPriceDrop(product.id, product.name).catch(() => undefined);
    }
  }

  private slugify(name: string, suffix: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
      .replace(/[đ]/g, 'd') // đ → d
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base}-${suffix.slice(-6).toLowerCase()}`;
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
