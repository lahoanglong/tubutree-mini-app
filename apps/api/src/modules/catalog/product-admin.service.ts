import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isStorefrontImageValue } from '../../common/uploaded-image';

export const PRODUCT_IMAGES_MAX = 8;
export const PRODUCT_CATEGORIES_MAX = 10;
const DESCRIPTION_MAX = 5000;
const SHORT_DESC_MAX = 300;

export interface ProductPatch {
  images?: string[];
  description?: string;
  shortDesc?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  categoryIds?: string[];
}

const SELECT = {
  id: true,
  name: true,
  slug: true,
  brand: true,
  pancakeId: true,
  storefrontId: true,
  approvalStatus: true,
  pancakeHold: true,
  isActive: true,
  isFeatured: true,
  description: true,
  shortDesc: true,
  images: true,
  thumbnail: true,
  categoryIds: true,
  basePrice: true,
  salePrice: true,
} as const;

/** Sản phẩm kho Tubu lấy từ Pancake (mã seed- là hàng mẫu nhập tay): tên, giá, tồn kho do đồng bộ ghi đè. */
export const isPancakeManaged = (p: { pancakeId: string | null }) => p.pancakeId !== null && !p.pancakeId.startsWith('seed-');

/**
 * Sửa sản phẩm trong trang quản trị. Chỉ các trường đồng bộ Pancake không đè (hoặc chỉ đè khi Pancake có nội dung thật):
 * ảnh, mô tả, mô tả ngắn, ẩn/hiện, nổi bật, danh mục. Tên, giá, tồn kho KHÔNG sửa ở đây: sản phẩm Pancake bị đồng bộ ghi đè lần sau, còn
 * sản phẩm của đối tác có luồng duyệt riêng (bản sửa chờ duyệt) mà sửa chen vào sẽ phá luồng đó.
 */
@Injectable()
export class ProductAdminService {
  private readonly logger = new Logger(ProductAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: SELECT });
    if (!p) throw new NotFoundException('Không tìm thấy sản phẩm.');
    return this.view(p);
  }

  async update(adminId: string, id: string, patch: ProductPatch) {
    const current = await this.prisma.product.findUnique({ where: { id }, select: SELECT });
    if (!current) throw new NotFoundException('Không tìm thấy sản phẩm.');

    const touchesContent = patch.images !== undefined || patch.description !== undefined || patch.shortDesc !== undefined;
    if (touchesContent && current.storefrontId !== null) {
      throw new BadRequestException('Ảnh và mô tả của sản phẩm đối tác do đối tác tự sửa trong Cổng người bán. Ở đây chỉ ẩn/hiện, nổi bật và danh mục.');
    }

    const data: Record<string, unknown> = {};
    if (patch.images !== undefined) {
      const images = patch.images.map((i) => i.trim());
      if (images.length > PRODUCT_IMAGES_MAX) throw new BadRequestException(`Tối đa ${PRODUCT_IMAGES_MAX} ảnh cho một sản phẩm.`);
      if (images.some((i) => i === '' || !isStorefrontImageValue(i))) {
        throw new BadRequestException('Ảnh chỉ nhận ảnh tải lên (png, jpeg, webp, gif) hoặc link https.');
      }
      data.images = images;
      data.thumbnail = images[0] ?? null;
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description.length > DESCRIPTION_MAX) throw new BadRequestException(`Mô tả tối đa ${DESCRIPTION_MAX} chữ.`);
      data.description = description;
    }
    if (patch.shortDesc !== undefined) {
      const shortDesc = patch.shortDesc?.trim() || null;
      if (shortDesc && shortDesc.length > SHORT_DESC_MAX) throw new BadRequestException(`Mô tả ngắn tối đa ${SHORT_DESC_MAX} chữ.`);
      data.shortDesc = shortDesc;
    }
    if (patch.isFeatured !== undefined) data.isFeatured = patch.isFeatured;
    if (patch.isActive !== undefined) {
      if (patch.isActive && !current.isActive) {
        if (current.pancakeHold !== null) {
          throw new ConflictException('Sản phẩm đang bị Pancake giữ lại (đã xoá khỏi Pancake hoặc chưa có giá), chưa bán lại được. Sửa ở Pancake rồi đợi đồng bộ.');
        }
        if (current.approvalStatus !== 'APPROVED') {
          throw new BadRequestException('Sản phẩm chưa được duyệt nên chưa bật bán được.');
        }
      }
      data.isActive = patch.isActive;
    }
    if (patch.categoryIds !== undefined) {
      const ids = [...new Set(patch.categoryIds)];
      if (ids.length > PRODUCT_CATEGORIES_MAX) throw new BadRequestException(`Tối đa ${PRODUCT_CATEGORIES_MAX} danh mục cho một sản phẩm.`);
      if (ids.length > 0) {
        const found = await this.prisma.category.count({ where: { id: { in: ids } } });
        if (found !== ids.length) throw new BadRequestException('Có danh mục không còn tồn tại, tải lại danh sách danh mục.');
      }
      data.categoryIds = ids;
    }

    const fields = Object.keys(data).filter((k) => k !== 'thumbnail');
    if (fields.length === 0) return this.view(current);
    const updated = await this.prisma.product.update({ where: { id }, data, select: SELECT });
    this.logger.warn(`Admin ${adminId} sửa sản phẩm ${id} (${current.name}): ${fields.join(', ')}`);
    return this.view(updated);
  }

  private view(p: {
    id: string;
    name: string;
    slug: string;
    brand: string;
    pancakeId: string | null;
    storefrontId: string | null;
    approvalStatus: string;
    pancakeHold: string | null;
    isActive: boolean;
    isFeatured: boolean;
    description: string;
    shortDesc: string | null;
    images: string[];
    thumbnail: string | null;
    categoryIds: string[];
    basePrice: number;
    salePrice: number | null;
  }) {
    const managed = isPancakeManaged(p);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      description: p.description,
      shortDesc: p.shortDesc,
      images: p.images,
      thumbnail: p.thumbnail,
      isActive: p.isActive,
      isFeatured: p.isFeatured,
      categoryIds: p.categoryIds,
      basePrice: p.basePrice,
      salePrice: p.salePrice,
      managedByPancake: managed,
      partnerOwned: p.storefrontId !== null,
      /** Lý do chưa bật bán lại được; null = bật được. */
      cannotShowReason:
        p.pancakeHold !== null
          ? 'Đang bị Pancake giữ lại (đã xoá khỏi Pancake hoặc chưa có giá).'
          : p.approvalStatus !== 'APPROVED'
            ? 'Chưa được duyệt.'
            : null,
    };
  }
}
