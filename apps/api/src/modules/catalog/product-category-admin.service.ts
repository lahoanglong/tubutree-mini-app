import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeListCursor, encodeListCursor } from '../affiliate/commission-admin.service';
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

  constructor(private readonly prisma: PrismaService) {}

  /** Sắp (tên, id), keyset như màn hoa hồng: sản phẩm vừa được gán rời bộ lọc "chưa có danh mục" thì trang sau vẫn đúng. */
  async listProducts(opts: {
    q?: string;
    uncategorized?: boolean;
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
    if (opts.categoryId) and.push({ categoryIds: { has: opts.categoryId } });
    if (q) {
      and.push({
        OR: [
          { nameSearch: { contains: escapePrismaLike(foldVietnamese(q)) } },
          { variations: { some: { sku: { contains: escapePrismaLike(q), mode: 'insensitive' } } } },
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
   * phẩm nên không đè danh mục khác admin vừa gán song song.
   */
  async assign(adminId: string, productIds: string[], categoryId: string, mode: CategoryAssignMode) {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw new BadRequestException('Chưa chọn sản phẩm nào.');
    if (ids.length > CATEGORY_ASSIGN_MAX_PRODUCTS) {
      throw new BadRequestException(`Mỗi lần chỉ gán tối đa ${CATEGORY_ASSIGN_MAX_PRODUCTS} sản phẩm.`);
    }
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true } });
    if (!category) throw new NotFoundException('Danh mục không tồn tại (có thể vừa bị xoá) — tải lại danh sách danh mục.');
    const found = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException(`${ids.length - found} sản phẩm đã chọn không còn tồn tại — tải lại danh sách.`);
    }
    const changed =
      mode === 'ADD'
        ? await this.prisma.$executeRaw`
            UPDATE "products" SET "categoryIds" = array_append("categoryIds", ${categoryId}), "updatedAt" = now()
            WHERE "id" = ANY(${ids}) AND NOT (${categoryId} = ANY("categoryIds"))`
        : await this.prisma.$executeRaw`
            UPDATE "products" SET "categoryIds" = array_remove("categoryIds", ${categoryId}), "updatedAt" = now()
            WHERE "id" = ANY(${ids}) AND ${categoryId} = ANY("categoryIds")`;
    this.logger.log(
      `Admin ${adminId} ${mode === 'ADD' ? 'gán' : 'gỡ'} danh mục "${category.name}" (${categoryId}) cho ${changed}/${ids.length} sản phẩm.`,
    );
    return { requested: ids.length, changed, unchanged: ids.length - changed, category: { id: category.id, name: category.name } };
  }
}
