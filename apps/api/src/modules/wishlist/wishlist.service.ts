import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Wishlist / Yêu thích (Build Spec §6.14.10). Lưu cặp user↔product. */
@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách sản phẩm đã thích, shape ProductCard (dùng chung FE). */
  async list(userId: string) {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
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
      }));
  }

  /** ID các sản phẩm đã thích — cho FE tô tim nhanh. */
  async ids(userId: string) {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  async add(userId: string, productId: string) {
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
