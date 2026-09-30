import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VARIATION_ID_RE } from './variation-id';

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  lastPurchasedAt: string;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
}
export interface PurchasedItemsOptions {
  cursor?: string;
  limit?: number;
  variationId?: string;
}

interface PurchasedRow {
  variationId: string;
  timesBought: number;
  lastPurchasedAt: Date;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Cursor = base64url("<epoch ms>|<variationId>"). So sánh bằng epoch ms (không phải timestamp)
 * để không phụ thuộc TimeZone của phiên Postgres với cột `timestamp without time zone`. */
export function encodePurchasedCursor(ms: number, variationId: string): string {
  return Buffer.from(`${ms}|${variationId}`, 'utf8').toString('base64url');
}

export function decodePurchasedCursor(cursor: string): { ms: number; variationId: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  const ms = Number(raw.slice(0, sep));
  const variationId = raw.slice(sep + 1);
  // variationId đi thẳng vào SQL thô: NUL / ký tự lạ làm Postgres ném lỗi → 500 thay vì 400.
  if (sep <= 0 || !Number.isSafeInteger(ms) || ms < 0 || !VARIATION_ID_RE.test(variationId)) {
    throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
  }
  return { ms, variationId };
}

/**
 * Sản phẩm khách đã mua THÀNH CÔNG (đơn DELIVERED), nhóm theo variation — nguồn cho kệ "Mua lại"
 * (spec §3.1). Chỉ dữ liệu của chính user (userId từ JWT). Loại variation/SP ngừng bán hoặc chưa
 * duyệt; SP chỉ hết hàng vẫn trả kèm inStock:false. lastPurchasedAt = createdAt của đơn giao gần
 * nhất (cùng định nghĩa với LifecycleService.sendReorderReminders).
 */
@Injectable()
export class PurchasedItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, opts: PurchasedItemsOptions = {}): Promise<PurchasedItemsPage> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const cursor = opts.cursor ? decodePurchasedCursor(opts.cursor) : null;
    const rows = await this.prisma.$queryRaw<PurchasedRow[]>(Prisma.sql`
      SELECT oi."variationId" AS "variationId",
             COUNT(DISTINCT o.id)::int AS "timesBought",
             MAX(o."createdAt") AS "lastPurchasedAt"
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      JOIN variations v ON v.id = oi."variationId"
      JOIN products p ON p.id = v."productId"
      WHERE o."userId" = ${userId}
        AND o.status::text = 'DELIVERED'
        AND v."isActive" = true
        AND p."isActive" = true
        AND p."approvalStatus"::text = 'APPROVED'
        ${opts.variationId ? Prisma.sql`AND oi."variationId" = ${opts.variationId}` : Prisma.empty}
      GROUP BY oi."variationId"
      ${
        cursor
          ? Prisma.sql`HAVING (FLOOR(EXTRACT(EPOCH FROM MAX(o."createdAt")) * 1000)::bigint, oi."variationId") < (${cursor.ms}::bigint, ${cursor.variationId})`
          : Prisma.empty
      }
      ORDER BY MAX(o."createdAt") DESC, oi."variationId" DESC
      LIMIT ${limit + 1}`);

    const page = rows.slice(0, limit);
    if (page.length === 0) return { items: [], nextCursor: null };

    const variations = await this.prisma.variation.findMany({
      where: { id: { in: page.map((r) => r.variationId) } },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        salePrice: true,
        stock: true,
        product: { select: { id: true, slug: true, name: true, brand: true, thumbnail: true, images: true } },
      },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    const items: PurchasedItem[] = [];
    for (const r of page) {
      const v = byId.get(r.variationId);
      if (!v) continue;
      items.push({
        variationId: v.id,
        productId: v.product.id,
        slug: v.product.slug,
        productName: v.product.name,
        variationName: v.name,
        brand: v.product.brand,
        thumbnail: v.product.thumbnail ?? v.product.images[0] ?? null,
        price: v.retailPrice,
        salePrice: v.salePrice,
        stock: Math.max(v.stock, 0),
        inStock: v.stock > 0,
        timesBought: Number(r.timesBought),
        lastPurchasedAt: new Date(r.lastPurchasedAt).toISOString(),
      });
    }
    const last = page[page.length - 1]!;
    return {
      items,
      nextCursor: rows.length > limit ? encodePurchasedCursor(new Date(last.lastPurchasedAt).getTime(), last.variationId) : null,
    };
  }
}
