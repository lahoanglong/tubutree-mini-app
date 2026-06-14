import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { LifecycleService } from '../../lifecycle/lifecycle.service';
import type { PancakeProductDTO } from './pancake.types';

/**
 * Đồng bộ catalog Pancake → Tubu (Build Spec §8.2).
 * - Cron mỗi 15 phút lấy sản phẩm đã đổi (updated_since).
 * - KHÔNG overwrite các trường Tubu tự quản: brand, slug, forSegment, ingredients,
 *   certifications, SEO meta, isFeatured (chỉ set khi tạo mới).
 */
@Injectable()
export class PancakeSyncService {
  private readonly logger = new Logger(PancakeSyncService.name);
  private lastRunAt: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly lifecycle: LifecycleService,
  ) {}

  @Cron('0 */15 * * * *') // mỗi 15 phút
  async scheduledSync(): Promise<void> {
    if (!this.client.isConfigured()) return; // dev: bỏ qua khi chưa có key
    await this.syncProducts(this.lastRunAt ?? undefined);
  }

  /** Đồng bộ toàn bộ (hoặc từ updatedSince). Trả số sản phẩm đã upsert. */
  async syncProducts(updatedSince?: string): Promise<number> {
    if (!this.client.isConfigured()) {
      this.logger.warn('Pancake chưa cấu hình — skip sync.');
      return 0;
    }
    // Mốc cursor lấy ở ĐẦU sync: sản phẩm đổi trong lúc sync sẽ được bắt ở lần kế
    // (upsert idempotent nên overlap nhẹ là an toàn — thà trùng còn hơn bỏ sót).
    const startedAt = new Date().toISOString();
    let page = 1;
    let count = 0;
    let failed = 0;
    for (;;) {
      const res = await this.client.fetchProducts(page, updatedSince);
      const products = res.data ?? res.products ?? [];
      if (products.length === 0) break;
      for (const p of products) {
        // Cô lập lỗi từng sản phẩm — 1 SP hỏng (vd slug trùng) không làm hỏng cả batch.
        try {
          await this.upsertProduct(p);
          count++;
        } catch (err) {
          failed++;
          this.logger.error(
            `Upsert sản phẩm Pancake ${p.product_id} lỗi: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      page++;
      if (products.length < 20) break; // hết trang (giả định page size ~20)
    }
    this.lastRunAt = startedAt;
    this.logger.log(`Đã đồng bộ ${count} sản phẩm từ Pancake${failed ? ` (${failed} lỗi, bỏ qua)` : ''}.`);
    return count;
  }

  private async upsertProduct(p: PancakeProductDTO): Promise<void> {
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

    const product = existing
      ? await this.prisma.product.update({ where: { id: existing.id }, data: baseData })
      : await this.prisma.product.create({
          data: {
            ...baseData,
            pancakeId,
            brand: 'Tubu Tree',
            slug: this.slugify(p.name, pancakeId),
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
          stock: v.remain_quantity ?? 0,
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
}
