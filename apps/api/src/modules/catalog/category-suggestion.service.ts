import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { effectiveCatalogBrand } from '@tubutree/shared-types';
import { publicProductThumb } from '../../common/public-image';
import { PrismaService } from '../../prisma/prisma.service';
import { withCoverImages } from './card-select';
import { CatalogService } from './catalog.service';
import { CATEGORY_SUGGEST_AUTO_MIN, suggestCategories, type CategorySuggestion } from './category-suggest';
import { CATEGORY_TREE_LOCK } from './category-tree';
import { HomeService } from './home.service';
import { PRODUCT_CATEGORIES_MAX } from './product-admin.service';
import { isPublicProduct } from './public-product';

/** Trần một lần đọc danh sách và một lần áp dụng; catalog Tubu hiện 111 sản phẩm. */
export const CATEGORY_SUGGEST_LIST_MAX = 500;
export const CATEGORY_APPLY_MAX = 500;
/** Dòng sổ `user_admin_events` (userId = admin bấm áp dụng). Màn chi tiết người dùng chỉ đọc các loại của nó nên không hiện dòng này. */
export const CATEGORY_APPLY_EVENT_KIND = 'CATALOG_CATEGORY_APPLY';

export interface CategorySuggestionRow {
  id: string;
  name: string;
  slug: string;
  brand: string;
  thumbnail: string | null;
  hasImage: boolean;
  /** Đang hiện cho khách (bật và đã duyệt). */
  onSale: boolean;
  /** Gửi lại nguyên văn khi áp dụng: máy chủ chỉ ghi khi sản phẩm chưa đổi từ lúc đọc. */
  updatedAt: string;
  suggestion: CategorySuggestion;
}

export interface CategorySuggestionList {
  categories: Array<{ id: string; name: string }>;
  items: CategorySuggestionRow[];
  autoMin: number;
  summary: { total: number; onSale: number; autoReady: number; needsReview: number; autoReadyOnSale: number; needsReviewOnSale: number };
  truncated: boolean;
}

export interface CategoryApplyItem {
  productId: string;
  categoryIds: string[];
  expectedUpdatedAt: string;
}

export type CategoryApplyConflictReason = 'missing' | 'categorized' | 'changed';

/**
 * Gán danh mục hàng loạt theo gợi ý (`category-suggest.ts`): đọc sản phẩm chưa có danh mục kèm gợi ý, và ghi bản admin đã duyệt.
 * Không có đường nào tự ghi: chỉ `apply` (admin bấm) mới đổi DB.
 */
@Injectable()
export class CategorySuggestionService {
  private readonly logger = new Logger(CategorySuggestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly home: HomeService,
  ) {}

  async list(): Promise<CategorySuggestionList> {
    const [categories, rows] = await Promise.all([
      this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true, parentId: true } }),
      this.prisma.product.findMany({
        where: { categoryIds: { isEmpty: true } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: CATEGORY_SUGGEST_LIST_MAX + 1,
        // Không chọn `images` (base64 tới ~1,5 triệu ký tự mỗi ảnh): ảnh đầu chỉ đọc cho hàng thiếu ảnh đại diện, qua `withCoverImages`.
        select: { id: true, name: true, slug: true, brand: true, thumbnail: true, isActive: true, approvalStatus: true, updatedAt: true },
      }),
    ]);
    const withCover = await withCoverImages(this.prisma, rows.slice(0, CATEGORY_SUGGEST_LIST_MAX));
    const leaves = leafCategories(categories);
    const validIds = new Set(leaves.map((c) => c.id));
    const items: CategorySuggestionRow[] = withCover.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: effectiveCatalogBrand(p.name, p.slug, p.brand),
      // Ảnh base64 cũ thành đường dẫn công khai: danh sách trăm dòng không mang cả ảnh trong JSON.
      thumbnail: publicProductThumb(p),
      hasImage: Boolean(p.thumbnail) || p.images.length > 0,
      onSale: isPublicProduct(p),
      updatedAt: p.updatedAt.toISOString(),
      suggestion: suggestCategories(p, validIds),
    }));
    const auto = (r: CategorySuggestionRow) => r.suggestion.categoryIds.length > 0 && r.suggestion.confidence >= CATEGORY_SUGGEST_AUTO_MIN;
    const onSale = items.filter((r) => r.onSale);
    return {
      categories: leaves.map(({ id, name }) => ({ id, name })),
      items,
      autoMin: CATEGORY_SUGGEST_AUTO_MIN,
      summary: {
        total: items.length,
        onSale: onSale.length,
        autoReady: items.filter(auto).length,
        needsReview: items.filter((r) => !auto(r)).length,
        autoReadyOnSale: onSale.filter(auto).length,
        needsReviewOnSale: onSale.filter((r) => !auto(r)).length,
      },
      truncated: rows.length > CATEGORY_SUGGEST_LIST_MAX,
    };
  }

  /**
   * Ghi cả lô hoặc không ghi gì. Mỗi sản phẩm chỉ được ghi khi `updatedAt` vẫn đúng bản admin đã xem VÀ vẫn chưa có danh mục: admin
   * khác vừa gán, đồng bộ Pancake vừa sửa hàng, hay hai tab cùng bấm thì lô sau nhận 409 kèm danh sách sản phẩm lệch, không đè gì.
   * Giữ khoá cây danh mục như mọi đường ghi danh mục khác, để danh mục vừa thành mục cha giữa chừng không nhận sản phẩm.
   */
  async apply(adminId: string, items: readonly CategoryApplyItem[]) {
    if (items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm nào.');
    if (items.length > CATEGORY_APPLY_MAX) throw new BadRequestException(`Mỗi lần chỉ áp dụng tối đa ${CATEGORY_APPLY_MAX} sản phẩm.`);
    if (new Set(items.map((i) => i.productId)).size !== items.length) throw new BadRequestException('Một sản phẩm xuất hiện hai lần trong lô.');
    const planned = items.map((i) => {
      const categoryIds = [...new Set(i.categoryIds)];
      if (categoryIds.length === 0) throw new BadRequestException('Mỗi sản phẩm cần ít nhất một danh mục.');
      if (categoryIds.length > PRODUCT_CATEGORIES_MAX) throw new BadRequestException(`Mỗi sản phẩm tối đa ${PRODUCT_CATEGORIES_MAX} danh mục.`);
      const expected = new Date(i.expectedUpdatedAt);
      if (Number.isNaN(expected.getTime())) throw new BadRequestException('Mốc cập nhật của sản phẩm không hợp lệ: tải lại danh sách.');
      return { productId: i.productId, categoryIds, expected };
    });

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_TREE_LOCK}))`;
        const wanted = [...new Set(planned.flatMap((p) => p.categoryIds))];
        const cats = await tx.category.findMany({ select: { id: true, name: true, parentId: true } });
        const leafIds = new Set(leafCategories(cats).map((c) => c.id));
        const bad = wanted.filter((id) => !leafIds.has(id));
        if (bad.length > 0) {
          const names = bad.map((id) => cats.find((c) => c.id === id)?.name ?? id);
          throw new BadRequestException(`Danh mục không gán được (đã xoá hoặc đã có mục con): ${names.join(', ')}. Tải lại danh sách.`);
        }
        const stale: string[] = [];
        const now = new Date();
        for (const p of planned) {
          // `updatedAt` ghi tay: CAS của lượt sau (và của đồng bộ Pancake) cần mốc mới ngay cả khi Prisma không tự đặt trên updateMany.
          const res = await tx.product.updateMany({
            where: { id: p.productId, updatedAt: p.expected, categoryIds: { isEmpty: true } },
            data: { categoryIds: p.categoryIds, updatedAt: now },
          });
          if (res.count === 0) stale.push(p.productId);
        }
        if (stale.length > 0) throw await this.conflict(tx, planned.filter((p) => stale.includes(p.productId)));
        await tx.userAdminEvent.createMany({
          data: planned.map((p) => ({
            userId: adminId,
            kind: CATEGORY_APPLY_EVENT_KIND,
            fromValue: '',
            toValue: p.categoryIds.join(','),
            reason: `product:${p.productId}`,
            actorId: adminId,
          })),
        });
      },
      { timeout: 30_000 },
    );

    this.catalog.invalidateCategoryCache();
    this.home.invalidateStatic();
    this.logger.log(`Admin ${adminId} áp dụng danh mục cho ${planned.length} sản phẩm.`);
    return { applied: planned.length, items: planned.map((p) => ({ productId: p.productId, categoryIds: p.categoryIds })) };
  }

  private async conflict(
    tx: Pick<PrismaService, 'product'>,
    stale: ReadonlyArray<{ productId: string; expected: Date }>,
  ): Promise<ConflictException> {
    const rows = await tx.product.findMany({
      where: { id: { in: stale.map((s) => s.productId) } },
      select: { id: true, name: true, categoryIds: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const conflicts = stale.map((s) => {
      const row = byId.get(s.productId);
      const reason: CategoryApplyConflictReason = !row ? 'missing' : row.categoryIds.length > 0 ? 'categorized' : 'changed';
      return { productId: s.productId, name: row?.name ?? null, reason };
    });
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'CATEGORY_APPLY_STALE',
      message: `${conflicts.length} sản phẩm vừa thay đổi từ lúc bạn mở danh sách (đã có danh mục, vừa được sửa hoặc đã xoá). Chưa ghi sản phẩm nào: tải lại danh sách rồi áp dụng lại.`,
      conflicts,
    });
  }
}

function leafCategories<T extends { id: string; parentId: string | null }>(rows: readonly T[]): T[] {
  const parents = new Set(rows.map((r) => r.parentId).filter((id): id is string => Boolean(id)));
  return rows.filter((r) => !parents.has(r.id));
}
