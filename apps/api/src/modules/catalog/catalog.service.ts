import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { ProductQuery } from './dto/product-query.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductQuery) {
    const { page, limit, brand, category, segment, q, sort } = query;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (brand) where.brand = brand;
    if (category) where.categoryIds = { has: category };
    if (segment) where.forSegment = { has: segment };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ];
    }

    const orderBy = this.orderBy(sort);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy,
        ...skipTake(page, limit),
        include: { variations: { where: { isActive: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(items.map((p) => this.toCard(p)), page, limit, total);
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: { variations: { where: { isActive: true } }, reviews: { where: { isVisible: true } } },
    });
    if (!product || !product.isActive) throw new NotFoundException('Không tìm thấy sản phẩm.');
    return product;
  }

  async related(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const items = await this.prisma.product.findMany({
      where: { isActive: true, brand: product.brand, id: { not: product.id } },
      take: 8,
      include: { variations: { where: { isActive: true } } },
    });
    // Trả cùng shape card với /products để FE dùng chung ProductCard.
    return items.map((p) => this.toCard(p));
  }

  /** "Thường mua kèm" (§6.12): co-occurrence trên đơn 90 ngày gần nhất. */
  async boughtTogether(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const since = new Date(Date.now() - 90 * 864e5);
    const rows = await this.prisma.$queryRaw<{ productId: string }[]>`
      WITH target_orders AS (
        SELECT DISTINCT oi."orderId"
        FROM order_items oi
        JOIN variations v ON v.id = oi."variationId"
        JOIN orders o ON o.id = oi."orderId"
        WHERE v."productId" = ${product.id} AND o."createdAt" >= ${since}
      )
      SELECT v2."productId" AS "productId", COUNT(*) AS cnt
      FROM order_items oi2
      JOIN variations v2 ON v2.id = oi2."variationId"
      WHERE oi2."orderId" IN (SELECT "orderId" FROM target_orders)
        AND v2."productId" <> ${product.id}
      GROUP BY v2."productId"
      ORDER BY cnt DESC
      LIMIT 6`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      include: { variations: { where: { isActive: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => this.toCard(p));
  }

  async brands() {
    const rows = await this.prisma.product.groupBy({
      by: ['brand'],
      where: { isActive: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({ brand: r.brand, count: r._count._all }));
  }

  categories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async suggest(q: string) {
    if (!q || q.length < 1) return [];
    const products = await this.prisma.product.findMany({
      where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
      take: 8,
      select: { slug: true, name: true, thumbnail: true, basePrice: true },
    });
    return products;
  }

  private orderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { basePrice: 'asc' };
      case 'price_desc':
        return { basePrice: 'desc' };
      case 'newest':
        return { createdAt: 'desc' };
      case 'rating':
        return { ratingAvg: 'desc' };
      default:
        return { isFeatured: 'desc' };
    }
  }

  private toCard(p: {
    id: string;
    slug: string;
    brand: string;
    name: string;
    thumbnail: string | null;
    images: string[];
    basePrice: number;
    salePrice: number | null;
    isFeatured: boolean;
    ratingAvg: number;
    reviewCount: number;
    variations: { stock: number }[];
  }) {
    return {
      id: p.id,
      slug: p.slug,
      brand: p.brand,
      name: p.name,
      thumbnail: p.thumbnail ?? p.images[0] ?? null,
      basePrice: p.basePrice,
      salePrice: p.salePrice,
      isFeatured: p.isFeatured,
      ratingAvg: p.ratingAvg,
      reviewCount: p.reviewCount,
      inStock: p.variations.some((v) => v.stock > 0),
    };
  }
}
