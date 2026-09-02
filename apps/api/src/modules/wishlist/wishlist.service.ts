import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Chặn tăng trưởng vô hạn: giới hạn hợp lý cho 1 wishlist (không ai cần thích quá số này).
const MAX_WISHLIST_ITEMS = 500;

/** Wishlist / Yêu thích (Build Spec §6.14.10). Lưu cặp user↔product. */
@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách sản phẩm đã thích, shape ProductCard (dùng chung FE). */
  async list(userId: string) {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_WISHLIST_ITEMS,
    });
    if (rows.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) }, isActive: true },
      include: { variations: { where: { isActive: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    // Giữ thứ tự thêm gần nhất, bỏ sản phẩm đã ẩn/xóa.
    return rows
      .map((r) => byId.get(r.productId))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        brand: p.brand,
        name: p.name,
        thumbnail: p.thumbnail ?? p.images[0] ?? null,
        basePrice: p.basePrice,
        salePrice: p.salePrice,
        isFeatured: p.isFeatured,
        inStock: p.variations.some((v) => v.stock > 0),
        // Đồng bộ với CatalogService.toCard() — thiếu các field này khiến card wishlist
        // không hiển thị sao đánh giá/đã bán như card catalog cùng sản phẩm.
        ratingAvg: p.ratingAvg,
        reviewCount: p.reviewCount,
        sold: (p.soldExternal ?? 0) + (p.soldApp ?? 0),
      }));
  }

  /** ID các sản phẩm đã thích — cho FE tô tim nhanh. */
  async ids(userId: string) {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      select: { productId: true },
      take: MAX_WISHLIST_ITEMS,
    });
    if (rows.length === 0) return [];
    // Lọc theo sản phẩm còn active — khớp với list() (tránh 2 endpoint bất nhất về cùng 1 sản phẩm).
    const active = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) }, isActive: true },
      select: { id: true },
    });
    return active.map((p) => p.id);
  }

  async add(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
    });
    if (!product || !product.isActive) throw new NotFoundException('Không tìm thấy sản phẩm.');
    await this.prisma.wishlist.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
    return { ok: true };
  }

  async remove(userId: string, productId: string) {
    await this.prisma.wishlist.deleteMany({ where: { userId, productId } });
    return { ok: true };
  }
}
