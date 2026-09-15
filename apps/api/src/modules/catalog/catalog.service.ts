import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { ProductQuery } from './dto/product-query.dto';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  // Brands/categories đổi 15 phút/lần qua sync Pancake nhưng đang query DB mỗi request
  // (brands() groupBy toàn bảng products). Cache 60s là đủ tươi mà giảm tải đáng kể.
  //
  // !!! HẠN CHẾ — KHÔNG AN TOÀN KHI SCALE:
  // - Cache PER-INSTANCE (field RAM) → khi tăng số replica API ≥ 2, mỗi replica có cache
  //   riêng + skew tới 60s giữa các replica → khách thấy dữ liệu khác nhau giữa request.
  // - Sync Pancake job + admin sửa Category KHÔNG gọi invalidate → brand/category mới
  //   trễ tới 60s. Tăng TTL ở đây mà không có invalidate sẽ làm vấn đề rõ hơn.
  // Khi scale → chuyển sang Redis (đã có trong compose), hoặc emit event từ sync job
  // để gọi invalidate trên TẤT CẢ instance.
  private brandsCache: { value: unknown; expiresAt: number } | null = null;
  private categoriesCache: { value: unknown; expiresAt: number } | null = null;
  private readonly TTL_MS = 60_000;

  // Mapper public-safe cho getBySlug() — endpoint /products/:slug là @Public() (không cần đăng
  // nhập). KHÔNG được `include` trần cho variations/reviews: `include` kéo TOÀN BỘ cột của
  // Prisma, gồm dealerPrices/affiliateRate (giá sỉ đại lý + % hoa hồng CTV) và reservedStock/
  // pancakeStock/pancakeId (nội bộ đồng bộ) ở Variation, cùng userId/orderId (định danh khách +
  // đơn hàng thật) ở Review — bất kỳ ai gọi API này đều lấy được. `stock` đã là tồn kho BÁN ĐƯỢC
  // (xem comment tại Variation.stock trong schema) nên không cần trừ reservedStock lại ở đây.
  private readonly publicVariationSelect = {
    id: true,
    sku: true,
    name: true,
    attributes: true,
    retailPrice: true,
    salePrice: true,
    stock: true,
    weight: true,
  } satisfies Prisma.VariationSelect;

  private readonly publicReviewSelect = {
    rating: true,
    comment: true,
    images: true,
    videoUrl: true,
    isVerified: true,
    createdAt: true,
  } satisfies Prisma.ReviewSelect;

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductQuery) {
    const { page, limit, brand, category, segment, q, sort } = query;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (brand) {
      const brandList = brand.split(',').map((b) => b.trim()).filter(Boolean);
      if (brandList.length === 1) {
        where.brand = brandList[0];
      } else if (brandList.length > 1) {
        where.brand = { in: brandList };
      }
    }
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
      include: {
        variations: { where: { isActive: true }, select: this.publicVariationSelect },
        // take:20 — trang chi tiết không phân trang review; sản phẩm nhiều review sẽ load hết
        // nếu không giới hạn. FE cần xem thêm thì gọi endpoint /products/:slug/reviews riêng.
        reviews: {
          where: { isVisible: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: this.publicReviewSelect,
        },
      },
    });
    if (!product || !product.isActive) throw new NotFoundException('Không tìm thấy sản phẩm.');
    return { ...product, sold: product.soldExternal + product.soldApp };
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

  /**
   * Feed "Dành cho bạn" — gợi ý cá nhân hoá rule-based (không ML):
   * 1) Lấy danh mục từ lịch sử mua gần đây (20 order item cuối) + nhãn đang theo dõi.
   * 2) Gợi ý sản phẩm active trùng danh mục HOẶC thuộc nhãn theo dõi, loại sản phẩm đã mua,
   *    sắp theo tổng đã bán (soldApp + soldExternal) giảm dần.
   * 3) Không có lịch sử/không match → fallback sản phẩm isFeatured (sắp theo đã bán).
   */
  async getForYou(userId: string) {
    const TAKE = 10;
    const RECENT_ITEMS = 20;

    const orderItems = await this.prisma.orderItem.findMany({
      where: { order: { userId } },
      orderBy: { order: { createdAt: 'desc' } },
      take: RECENT_ITEMS,
      select: { variationId: true },
    });

    const variationIds = [...new Set(orderItems.map((oi) => oi.variationId))];
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, productId: true },
        })
      : [];
    const purchasedProductIds = [...new Set(variations.map((v) => v.productId))];

    const purchasedProducts = purchasedProductIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: purchasedProductIds } },
          select: { categoryIds: true },
        })
      : [];
    const categorySet = [...new Set(purchasedProducts.flatMap((p) => p.categoryIds))];

    const follows = await this.prisma.brandFollow.findMany({
      where: { userId },
      select: { brandId: true },
    });
    const followedBrandIds = follows.map((f) => f.brandId);

    let items: Parameters<typeof this.toCard>[0][] = [];
    if (categorySet.length > 0 || followedBrandIds.length > 0) {
      const or: Prisma.ProductWhereInput[] = [];
      if (categorySet.length > 0) or.push({ categoryIds: { hasSome: categorySet } });
      if (followedBrandIds.length > 0) or.push({ brandId: { in: followedBrandIds } });
      const where: Prisma.ProductWhereInput = { isActive: true, OR: or };
      if (purchasedProductIds.length) where.id = { notIn: purchasedProductIds };
      items = await this.prisma.product.findMany({
        where,
        // take:200 — trước đây không giới hạn nên load HẾT sản phẩm khớp rồi mới sort+cắt 10
        // trong JS; catalog càng lớn càng nặng. 200 ứng viên là đủ dư để sort lấy top 10.
        take: 200,
        include: { variations: { where: { isActive: true } } },
      });
    }

    if (items.length === 0) {
      items = await this.prisma.product.findMany({
        where: { isActive: true, isFeatured: true },
        take: 200,
        include: { variations: { where: { isActive: true } } },
      });
    }

    const sorted = [...items].sort(
      (a, b) => b.soldExternal + b.soldApp - (a.soldExternal + a.soldApp),
    );
    return sorted.slice(0, TAKE).map((p) => this.toCard(p));
  }

  async brands() {
    if (this.brandsCache && this.brandsCache.expiresAt > Date.now()) {
      return this.brandsCache.value;
    }
    const rows = await this.prisma.product.groupBy({
      by: ['brand'],
      where: { isActive: true },
      _count: { _all: true },
    });
    const value = rows.map((r) => ({ brand: r.brand, count: r._count._all }));
    this.brandsCache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }

  async categories() {
    if (this.categoriesCache && this.categoriesCache.expiresAt > Date.now()) {
      return this.categoriesCache.value;
    }
    const value = await this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    this.categoriesCache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
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
    soldExternal: number;
    soldApp: number;
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
      sold: (p.soldExternal ?? 0) + (p.soldApp ?? 0), // tổng "đã bán" (sàn ngoài + app)
      inStock: p.variations.some((v) => v.stock > 0),
    };
  }

  /**
   * Tính lại `soldApp` (đơn DELIVERED, cộng dồn theo product) — idempotent: reset 0 rồi set,
   * nên tự GIẢM khi đơn bị RETURNED. Hiển thị "đã bán" = soldExternal + soldApp.
   */
  async recomputeSoldCounts(): Promise<{ updated: number }> {
    const grouped = await this.prisma.orderItem.groupBy({
      by: ['variationId'],
      where: { order: { status: 'DELIVERED' } },
      _sum: { quantity: true },
    });
    const variationIds = grouped.map((g) => g.variationId);
    const vars = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, productId: true },
        })
      : [];
    const vmap = new Map(vars.map((v) => [v.id, v.productId]));
    const perProduct = new Map<string, number>();
    for (const g of grouped) {
      const pid = vmap.get(g.variationId);
      if (!pid) continue;
      perProduct.set(pid, (perProduct.get(pid) ?? 0) + (g._sum.quantity ?? 0));
    }
    // Reset phải nguyên tử cùng với lần ghi lại — nhưng KHÔNG được reset toàn bảng bên trong
    // transaction: `updateMany` không điều kiện khoá MỌI dòng `products` cho tới khi N lệnh
    // update chạy xong, đủ để chặn đứng cron đồng bộ Pancake (cũng nổ lúc 03:00) và mọi thao tác
    // sửa sản phẩm của admin/đối tác. Trước đó nữa thì reset commit riêng, nên một sản phẩm bị
    // xoá giữa chừng làm transaction rollback trong khi reset đã commit — cả catalog hiện "đã
    // bán 0" suốt 24 giờ.
    //
    // Cách hiện tại: chỉ chạm đúng những dòng CẦN đổi.
    //  - Dòng có số bán mới → update từng dòng (khoá đúng dòng đó).
    //  - Dòng đang khác 0 mà không còn đơn nào → đưa về 0, một câu lệnh, phạm vi hẹp.
    const ids = [...perProduct.keys()];
    const ops = [
      ...[...perProduct.entries()].map(([productId, sold]) =>
        this.prisma.product.update({ where: { id: productId }, data: { soldApp: sold } }),
      ),
      this.prisma.product.updateMany({
        where: { soldApp: { not: 0 }, ...(ids.length ? { id: { notIn: ids } } : {}) },
        data: { soldApp: 0 },
      }),
    ];
    await this.prisma.$transaction(ops);
    return { updated: perProduct.size };
  }

  /** Cron 03:00 hằng ngày — tính lại số đã bán (social proof không cần realtime). */
  @Cron('0 3 * * *')
  async recomputeSoldCron(): Promise<void> {
    // Nuốt lỗi im lặng ở đây từng khiến hỏng mà không ai biết — số "đã bán" sai cả ngày và
    // không có một dòng log nào để lần ra.
    await this.recomputeSoldCounts().catch((err) =>
      this.logger.error(`Tính lại số đã bán lỗi: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Admin nhập tổng đã bán từ sàn ngoài theo SKU (variation.sku → product.soldExternal).
   * Trước đây findUnique+update TUẦN TỰ từng dòng — N+1 thật khi admin đối soát vài nghìn SKU
   * (hàng nghìn round-trip DB nối tiếp nhau). Fix: gom 1 findMany rồi cập nhật theo lô qua
   * $transaction, ~50 dòng/lô để không gửi 1 transaction khổng lồ.
   */
  async setSoldExternal(rows: { sku: string; count: number }[]): Promise<{ updated: number }> {
    const BATCH_SIZE = 50;
    const valid = rows.filter((r) => r.sku && Number.isFinite(r.count) && r.count >= 0);
    if (valid.length === 0) return { updated: 0 };

    const skus = [...new Set(valid.map((r) => r.sku))];
    const variations = await this.prisma.variation.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, productId: true },
    });
    const productIdBySku = new Map(variations.map((v) => [v.sku, v.productId]));

    let updated = 0;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const ops = batch
        .map((r) => {
          const productId = productIdBySku.get(r.sku);
          if (!productId) return null;
          return this.prisma.product.update({
            where: { id: productId },
            data: { soldExternal: Math.floor(r.count) },
          });
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);
      if (ops.length === 0) continue;
      await this.prisma.$transaction(ops);
      updated += ops.length;
    }
    return { updated };
  }
}
