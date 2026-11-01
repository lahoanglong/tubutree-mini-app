import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeListCursor, encodeListCursor } from '../affiliate/commission-admin.service';
import { CatalogService } from './catalog.service';
import { CATEGORY_MSG, CATEGORY_TREE_LOCK } from './category-tree';
import { HomeService } from './home.service';
import { PUBLIC_PRODUCT_WHERE } from './public-product';
import { escapePrismaLike, foldVietnamese } from './search-text';

export const CATEGORY_ASSIGN_MAX_PRODUCTS = 500;
export type CategoryAssignMode = 'ADD' | 'REMOVE';

/**
 * Gán/gỡ danh mục hàng loạt cho sản phẩm (đồng bộ Pancake không ghi `categoryIds`, nên đây là đường gán duy nhất cho hàng
 * kho Tubu). Đồng bộ cũng không ghi đè cột này khi sản phẩm đã có danh mục (PancakeSyncService.upsertProduct).
 */
@Injectable()
export class ProductCategoryAdminService {
  private readonly logger = new Logger(ProductCategoryAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly home: HomeService,
  ) {}

  /** Sắp (tên, id), keyset như màn hoa hồng: sản phẩm vừa được gán rời bộ lọc "chưa có danh mục" thì trang sau vẫn đúng. */
  async listProducts(opts: {
    q?: string;
    uncategorized?: boolean;
    /** Chỉ sản phẩm đang bán thật (bật và đã duyệt): cùng điều kiện với số "chưa có danh mục" của hộp việc. */
    onSale?: boolean;
    missingImage?: boolean;
    source?: 'pancake' | 'all';
    categoryId?: string;
    cursor?: string;
    take: number;
  }) {
    const q = opts.q?.trim();
    const after = opts.cursor ? decodeListCursor(opts.cursor) : null;
    const and: Prisma.ProductWhereInput[] = [];
    if (opts.source === 'pancake') and.push({ pancakeId: { not: null }, NOT: { pancakeId: { startsWith: 'seed-' } } });
    if (opts.uncategorized) and.push({ categoryIds: { isEmpty: true } });
    if (opts.onSale) and.push(PUBLIC_PRODUCT_WHERE);
    // Đang bán mà chưa có ảnh nào: khách thấy ô trống ở danh mục.
    if (opts.missingImage) and.push({ isActive: true, images: { isEmpty: true } });
    if (opts.categoryId) and.push({ categoryIds: { has: opts.categoryId } });
    if (q) {
      and.push({
        OR: [
          { nameSearch: { contains: escapePrismaLike(foldVietnamese(q)) } },
          { variations: { some: { sku: { contains: escapePrismaLike(q), mode: 'insensitive' } } } },
          { brand: { contains: escapePrismaLike(q), mode: 'insensitive' } },
        ],
      });
    }
    const cursorWhere = after ? [{ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] }] : [];
    const where: Prisma.ProductWhereInput = { AND: [...and, ...cursorWhere] };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: opts.take + 1,
        select: { id: true, name: true, thumbnail: true, brand: true, pancakeId: true, isActive: true, categoryIds: true },
      }),
      // Tổng theo bộ lọc, không tính con trỏ trang.
      this.prisma.product.count({ where: { AND: and } }),
    ]);
    const page = rows.slice(0, opts.take);
    return {
      items: page,
      total,
      nextCursor: rows.length > opts.take && page.length ? encodeListCursor(page[page.length - 1]!) : null,
    };
  }

  /**
   * ADD: thêm danh mục vào sản phẩm chưa có; REMOVE: gỡ khỏi sản phẩm đang có. Một câu SQL nguyên tử theo từng sản
   * phẩm nên không đè danh mục khác admin vừa gán song song. `COALESCE` vì hàng cũ có thể mang NULL (xem migration
   * product_category_ids_default): `x = ANY(NULL)` là NULL nên câu gán sẽ lặng lẽ bỏ qua hàng đó.
   */
  async assign(adminId: string, productIds: string[], categoryId: string, mode: CategoryAssignMode) {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw new BadRequestException('Chưa chọn sản phẩm nào.');
    if (ids.length > CATEGORY_ASSIGN_MAX_PRODUCTS) {
      throw new BadRequestException(`Mỗi lần chỉ gán tối đa ${CATEGORY_ASSIGN_MAX_PRODUCTS} sản phẩm.`);
    }
    // ADD giữ khoá cây rồi mới kiểm lá và ghi: một admin vừa thêm mục con vào danh mục này thì lệnh gán phải thấy mục con, không lọt vào cha.
    const { category, changed } = mode === 'ADD' ? await this.addToLeaf(ids, categoryId) : await this.removeFrom(ids, categoryId);
    if (changed > 0) {
      this.catalog.invalidateCategoryCache();
      this.home.invalidateStatic();
    }
    this.logger.log(
      `Admin ${adminId} ${mode === 'ADD' ? 'gán' : 'gỡ'} danh mục "${category.name}" (${categoryId}) cho ${changed}/${ids.length} sản phẩm.`,
    );
    return { requested: ids.length, changed, unchanged: ids.length - changed, category: { id: category.id, name: category.name } };
  }

  private async addToLeaf(ids: string[], categoryId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_TREE_LOCK}))`;
      const category = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true } });
      if (!category) throw new NotFoundException(CATEGORY_MSG.notFound());
      if ((await tx.category.count({ where: { parentId: categoryId } })) > 0) throw new BadRequestException(CATEGORY_MSG.notLeaf(category.name));
      await this.assertProductsExist(tx, ids);
      const changed = await tx.$executeRaw`
        UPDATE "products" SET "categoryIds" = array_append(COALESCE("categoryIds", ARRAY[]::text[]), ${categoryId}), "updatedAt" = now()
        WHERE "id" = ANY(${ids}) AND NOT (${categoryId} = ANY(COALESCE("categoryIds", ARRAY[]::text[])))`;
      return { category, changed };
    });
  }

  /** Gỡ không kiểm lá: dọn được sản phẩm đã gán vào danh mục trước khi nó có mục con. */
  private async removeFrom(ids: string[], categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true } });
    if (!category) throw new NotFoundException(CATEGORY_MSG.notFound());
    await this.assertProductsExist(this.prisma, ids);
    const changed = await this.prisma.$executeRaw`
      UPDATE "products" SET "categoryIds" = array_remove("categoryIds", ${categoryId}), "updatedAt" = now()
      WHERE "id" = ANY(${ids}) AND ${categoryId} = ANY("categoryIds")`;
    return { category, changed };
  }

  private async assertProductsExist(db: Pick<PrismaService, 'product'>, ids: string[]): Promise<void> {
    const found = await db.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException(`${ids.length - found} sản phẩm đã chọn không còn tồn tại — tải lại danh sách.`);
    }
  }
}
