import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isStorefrontImageValue } from '../../common/uploaded-image';
import { storedThumbnailFor } from '../../common/public-image';
import { CATEGORY_MSG, CATEGORY_TREE_LOCK } from './category-tree';
import { Prisma } from '@prisma/client';
import { parseStoryConfig } from '@tubutree/shared-types';
import { ImageResizeService } from './image-resize.service';

export const PRODUCT_IMAGES_MAX = 8;
export const PRODUCT_CATEGORIES_MAX = 10;

export interface ProductPatch {
  images?: string[];
  description?: string;
  shortDesc?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  categoryIds?: string[];
  /** Cấu hình câu chuyện sản phẩm; null = xoá (quay về preset/tự sinh). Kiểm bằng parseStoryConfig trước khi ghi. */
  storyConfig?: unknown;
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
  storyConfig: true,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageResize: ImageResizeService,
  ) {}

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
      // Ảnh đầu là base64 thì thumbnail chỉ giữ đường dẫn tới ảnh đó: cùng một ảnh không nằm hai lần trong DB và JSON thẻ sản phẩm nhẹ.
      data.thumbnail = storedThumbnailFor(id, images[0]);
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      data.description = description;
    }
    if (patch.shortDesc !== undefined) {
      const shortDesc = patch.shortDesc?.trim() || null;
      data.shortDesc = shortDesc;
    }
    if (patch.isFeatured !== undefined) data.isFeatured = patch.isFeatured;
    if (patch.storyConfig !== undefined) {
      if (patch.storyConfig === null) data.storyConfig = Prisma.DbNull;
      else {
        const parsed = parseStoryConfig(patch.storyConfig);
        if (!parsed.ok) throw new BadRequestException(`Cấu hình câu chuyện sản phẩm không hợp lệ: ${parsed.error}.`);
        data.storyConfig = parsed.value as unknown as Prisma.InputJsonValue;
      }
    }
    if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
      // Hàng đối tác bật/tắt theo luồng của gian hàng (duyệt lại, gỡ/gắn liên kết Pancake): bật ở đây bỏ qua luồng đó và có thể
      // mở bán sản phẩm không còn biến thể nào, tắt ở đây thì gian hàng thấy trạng thái lệch với bản duyệt.
      if (current.storefrontId !== null) {
        throw new BadRequestException('Hàng của đối tác bật hoặc tắt qua gian hàng và luồng duyệt, không đổi ở đây.');
      }
      if (patch.isActive) {
        if (current.pancakeHold !== null) {
          throw new ConflictException('Sản phẩm đang bị Pancake giữ lại (đã xoá khỏi Pancake hoặc chưa có giá), chưa bán lại được. Sửa ở Pancake rồi đợi đồng bộ.');
        }
        if (current.approvalStatus !== 'APPROVED') {
          throw new BadRequestException('Sản phẩm chưa được duyệt nên chưa bật bán được.');
        }
        const sellable = await this.prisma.variation.count({ where: { productId: id, isActive: true } });
        if (sellable === 0) {
          throw new BadRequestException('Sản phẩm không còn biến thể nào đang bán (có thể đã chuyển sang gian hàng đối tác), bật lên khách cũng không mua được.');
        }
      }
      data.isActive = patch.isActive;
    }
    let updated;
    if (patch.categoryIds === undefined) {
      if (Object.keys(data).filter((k) => k !== 'thumbnail').length === 0) return this.view(current);
      updated = await this.prisma.product.update({ where: { id }, data, select: SELECT });
    } else {
      // Kiểm danh mục và ghi mảng cùng một transaction giữ khoá cây: lệnh xoá danh mục và gán hàng loạt ADD cũng giữ khoá này, nên danh mục vừa kiểm còn sống không bị xoá trước khi ghi.
      const categoryIds = patch.categoryIds;
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_TREE_LOCK}))`;
        data.categoryIds = await this.resolveCategoryIds(tx, id, categoryIds);
        return tx.product.update({ where: { id }, data, select: SELECT });
      });
    }
    const fields = Object.keys(data).filter((k) => k !== 'thumbnail');
    if (data.images !== undefined) this.imageResize.invalidateRegistry();
    this.logger.warn(`Admin ${adminId} sửa sản phẩm ${id} (${current.name}): ${fields.join(', ')}`);
    return this.view(updated);
  }

  /**
   * Danh mục sẽ ghi, tính trên bản đang lưu (đọc dưới khoá cây). Id không còn tồn tại mà sản phẩm đã mang từ trước thì bỏ đi
   * (danh mục bị xoá khi sản phẩm vẫn gắn), nếu không sản phẩm bị 400 mãi vì drawer không vẽ chip để gỡ. Trần chỉ chặn khi số danh mục tăng:
   * sản phẩm đã quá trần thì admin vẫn bỏ bớt được.
   */
  private async resolveCategoryIds(tx: Prisma.TransactionClient, productId: string, raw: string[]): Promise<string[]> {
    const ids = [...new Set(raw)];
    const stored = await tx.product.findUnique({ where: { id: productId }, select: { categoryIds: true } });
    if (!stored) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const had = new Set(stored.categoryIds);
    const lookup = [...new Set([...ids, ...stored.categoryIds])];
    const alive = new Set(lookup.length > 0 ? (await tx.category.findMany({ where: { id: { in: lookup } }, select: { id: true } })).map((c) => c.id) : []);
    if (ids.some((c) => !alive.has(c) && !had.has(c))) throw new BadRequestException('Có danh mục không còn tồn tại, tải lại danh sách danh mục.');
    const kept = ids.filter((c) => alive.has(c));
    const liveBefore = stored.categoryIds.filter((c) => alive.has(c)).length;
    if (kept.length > PRODUCT_CATEGORIES_MAX && kept.length > liveBefore) {
      throw new BadRequestException(`Tối đa ${PRODUCT_CATEGORIES_MAX} danh mục cho một sản phẩm.`);
    }
    // Chỉ hỏi các id mới thêm: sản phẩm đã gán vào một danh mục từ trước khi nó có mục con vẫn sửa được các trường khác.
    const added = kept.filter((c) => !had.has(c));
    if (added.length > 0) {
      const parent = await tx.category.findMany({ where: { id: { in: added }, children: { some: {} } }, select: { name: true }, take: 1 });
      if (parent[0]) throw new BadRequestException(CATEGORY_MSG.notLeaf(parent[0].name));
    }
    return kept;
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
    storyConfig?: unknown;
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
      storyConfig: p.storyConfig ?? null,
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
