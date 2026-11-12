import { Injectable } from '@nestjs/common';
import type { CatalogAuditProductDto, CatalogAuditResponse } from '@tubutree/shared-types';
import { publicProductThumb } from '../../common/public-image';
import { PrismaService } from '../../prisma/prisma.service';
import { ingredientNames } from './ingredient-names';
import { VARIATION_ORDER_BY } from './variation-order';

/** Trần số sản phẩm một lần đọc; vượt thì `truncated`. Catalog Tubu hiện vài trăm SKU nên trần này chỉ để bảo vệ máy chủ. */
export const CATALOG_AUDIT_MAX = 2000;

/**
 * Dữ liệu cho bàn làm việc chất lượng catalog của admin: mọi sản phẩm của Tubu (không phải của đối tác) kể cả đang ẩn hay bị Pancake giữ lại,
 * kèm cả biến thể đã tắt. Lý do lấy cả hàng ẩn: SKU ẩn giá 0 là thứ gây nhiễu đồng bộ nên admin cần thấy để dọn.
 * Chỉ đọc; chỉ select cột cần (không `images`, vì ảnh base64 có thể tới ~1,5 triệu ký tự mỗi ảnh).
 */
@Injectable()
export class CatalogAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async audit(): Promise<CatalogAuditResponse> {
    const rows = await this.prisma.product.findMany({
      where: { storefrontId: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: CATALOG_AUDIT_MAX + 1,
      select: {
        id: true,
        slug: true,
        name: true,
        pancakeId: true,
        isActive: true,
        thumbnail: true,
        description: true,
        shortDesc: true,
        ingredients: true,
        variations: {
          orderBy: VARIATION_ORDER_BY,
          select: { id: true, pancakeId: true, sku: true, name: true, stock: true, retailPrice: true, isActive: true },
        },
      },
    });
    const truncated = rows.length > CATALOG_AUDIT_MAX;
    const products: CatalogAuditProductDto[] = rows.slice(0, CATALOG_AUDIT_MAX).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      pancakeId: p.pancakeId,
      isActive: p.isActive,
      thumbnail: publicProductThumb({ id: p.id, thumbnail: p.thumbnail }),
      description: p.description,
      shortDesc: p.shortDesc,
      hasIngredients: ingredientNames(p.ingredients).length > 0,
      inStock: p.isActive && p.variations.some((v) => v.isActive && v.stock > 0),
      variations: p.variations,
    }));
    return { products, truncated };
  }
}
