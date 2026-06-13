import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
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
    const existing = await this.prisma.product.findUnique({ where: { pancakeId: p.product_id } });

    const baseData = {
      name: p.name,
      description: p.description ?? existing?.description ?? '',
      images: p.images ?? existing?.images ?? [],
      thumbnail: p.images?.[0] ?? existing?.thumbnail ?? null,
      basePrice: p.variations?.[0]?.retail_price ?? existing?.basePrice ?? 0,
    };

    const product = existing
      ? await this.prisma.product.update({ where: { id: existing.id }, data: baseData })
      : await this.prisma.product.create({
          data: {
            ...baseData,
            pancakeId: p.product_id,
            brand: 'Tubu Tree',
            slug: this.slugify(p.name, p.product_id),
          },
        });

    for (const v of p.variations ?? []) {
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
