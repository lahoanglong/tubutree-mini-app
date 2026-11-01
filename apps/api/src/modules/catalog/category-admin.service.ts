import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CATEGORY_PARENT_HAS_PRODUCTS } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';
import {
  CATEGORY_MAX_CHILDREN,
  CATEGORY_MAX_ROOTS,
  CATEGORY_MSG,
  CATEGORY_NAME_MAX,
  CATEGORY_TREE_LOCK,
  categorySlugBase,
  sameCategoryName,
  uniqueCategorySlug,
} from './category-tree';
import { HomeService } from './home.service';

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  /** Cha không còn trong bảng thì trả null: màn quản trị coi như gốc, giống cây công khai. */
  parentId: string | null;
  sortOrder: number;
  /** Sản phẩm gắn thẳng vào mục này (mọi trạng thái, kể cả đang tắt). */
  productCount: number;
  /** Sản phẩm của mục và các mục con, mỗi sản phẩm một lần. */
  totalCount: number;
}
export interface AdminCategoryList {
  items: AdminCategoryRow[];
  limits: { maxRoots: number; maxChildren: number };
}

interface TreeRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

const TREE_SELECT = { id: true, name: true, slug: true, parentId: true, sortOrder: true } as const;
const TREE_ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] as const;

/** Cha hiệu lực: null khi không có cha, cha đã bị xoá hoặc tự trỏ vào chính mình. */
function effectiveParents(rows: readonly TreeRow[]): Map<string, string | null> {
  const ids = new Set(rows.map((r) => r.id));
  return new Map(rows.map((r) => [r.id, r.parentId && r.parentId !== r.id && ids.has(r.parentId) ? r.parentId : null]));
}

/**
 * Quản trị cây danh mục hai tầng (≤8 gốc × ≤8 con). Mọi ghi chạy trong một transaction giữ khoá advisory chung của cây
 * (`CATEGORY_TREE_LOCK`, cũng là khoá của gán ADD ở ProductCategoryAdminService): hai admin cùng thêm vào chỗ trống cuối
 * cùng thì đúng một lệnh thành công, và gán sản phẩm không lọt vào danh mục vừa có con.
 */
@Injectable()
export class CategoryAdminService {
  private readonly logger = new Logger(CategoryAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly home: HomeService,
  ) {}

  async list(): Promise<AdminCategoryList> {
    const [rows, products] = await Promise.all([
      this.prisma.category.findMany({ select: TREE_SELECT, orderBy: [...TREE_ORDER] }),
      this.prisma.product.findMany({ where: { categoryIds: { isEmpty: false } }, select: { categoryIds: true } }),
    ]);
    const parentOf = effectiveParents(rows);
    const direct = new Map<string, number>();
    const total = new Map<string, number>();
    for (const p of products) {
      const covered = new Set<string>();
      for (const id of new Set(p.categoryIds)) {
        if (!parentOf.has(id)) continue;
        direct.set(id, (direct.get(id) ?? 0) + 1);
        for (let cur: string | null | undefined = id; cur && !covered.has(cur); cur = parentOf.get(cur)) covered.add(cur);
      }
      for (const id of covered) total.set(id, (total.get(id) ?? 0) + 1);
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        parentId: parentOf.get(r.id) ?? null,
        sortOrder: r.sortOrder,
        productCount: direct.get(r.id) ?? 0,
        totalCount: total.get(r.id) ?? 0,
      })),
      limits: { maxRoots: CATEGORY_MAX_ROOTS, maxChildren: CATEGORY_MAX_CHILDREN },
    };
  }

  async create(adminId: string, dto: { name: string; parentId?: string | null; confirmDirectProducts?: boolean }): Promise<AdminCategoryRow> {
    const name = this.cleanName(dto.name);
    const created = await this.write(async (tx, rows) => {
      const parentOf = effectiveParents(rows);
      const parentId = dto.parentId ?? null;
      if (parentId) {
        const parent = rows.find((r) => r.id === parentId);
        if (!parent) throw new NotFoundException(CATEGORY_MSG.notFound());
        if (parentOf.get(parent.id) !== null) throw new BadRequestException(CATEGORY_MSG.parentNotRoot());
      }
      const siblings = rows.filter((r) => parentOf.get(r.id) === parentId);
      this.assertRoom(rows, parentId, siblings.length);
      this.assertNameFree(name, siblings);
      if (parentId && siblings.length === 0) await this.assertDirectProductsConfirmed(tx, rows.find((r) => r.id === parentId)!, dto.confirmDirectProducts);
      const slug = uniqueCategorySlug(categorySlugBase(name), new Set(rows.map((r) => r.slug)));
      const sortOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0;
      return tx.category.create({ data: { name, slug, parentId, sortOrder }, select: TREE_SELECT });
    });
    this.logger.log(`Admin ${adminId} tạo danh mục "${created.name}" (${created.id}) ${created.parentId ? `trong ${created.parentId}` : 'ở tầng gốc'}.`);
    return this.rowOf(created.id);
  }

  async update(adminId: string, id: string, patch: { name?: string; parentId?: string | null; confirmDirectProducts?: boolean }): Promise<AdminCategoryRow> {
    const name = patch.name === undefined ? undefined : this.cleanName(patch.name);
    await this.write(async (tx, rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundException(CATEGORY_MSG.notFound());
      const parentOf = effectiveParents(rows);
      const currentParent = parentOf.get(id) ?? null;
      const data: Prisma.CategoryUncheckedUpdateInput = {};
      let targetParent = currentParent;
      let movedGroup = false;

      if (patch.parentId !== undefined) {
        const wanted = patch.parentId;
        if (wanted === id) throw new BadRequestException(CATEGORY_MSG.parentNotRoot());
        if (wanted !== currentParent) {
          if (wanted) {
            const target = rows.find((r) => r.id === wanted);
            if (!target) throw new NotFoundException(CATEGORY_MSG.notFound());
            if (parentOf.get(target.id) !== null) throw new BadRequestException(CATEGORY_MSG.parentNotRoot());
            if (rows.some((r) => parentOf.get(r.id) === id)) throw new BadRequestException(CATEGORY_MSG.hasChildrenCannotNest(row.name));
          }
          const group = rows.filter((r) => parentOf.get(r.id) === wanted);
          this.assertRoom(rows, wanted, group.length);
          if (wanted && group.length === 0) await this.assertDirectProductsConfirmed(tx, rows.find((r) => r.id === wanted)!, patch.confirmDirectProducts);
          targetParent = wanted;
          movedGroup = true;
        }
        // Cha trỏ vào id đã xoá: ghi lại null để dữ liệu khớp với cách màn hình hiểu.
        if (movedGroup || row.parentId !== wanted) data.parentId = wanted;
      }

      const newName = name ?? row.name;
      if (name !== undefined || movedGroup) {
        this.assertNameFree(newName, rows.filter((r) => r.id !== id && parentOf.get(r.id) === targetParent));
      }
      if (name !== undefined) data.name = name;
      if (movedGroup) {
        const group = rows.filter((r) => r.id !== id && parentOf.get(r.id) === targetParent);
        data.sortOrder = group.length ? Math.max(...group.map((s) => s.sortOrder)) + 1 : 0;
      }
      if (Object.keys(data).length > 0) await tx.category.update({ where: { id }, data, select: TREE_SELECT });
    });
    this.logger.log(`Admin ${adminId} sửa danh mục ${id}: ${[name !== undefined && 'tên', patch.parentId !== undefined && 'cha'].filter(Boolean).join(', ') || 'không đổi'}.`);
    return this.rowOf(id);
  }

  async reorder(adminId: string, parentId: string | null, orderedIds: string[]): Promise<AdminCategoryList> {
    await this.write(async (tx, rows) => {
      const parentOf = effectiveParents(rows);
      if (parentId && !rows.some((r) => r.id === parentId)) throw new NotFoundException(CATEGORY_MSG.notFound());
      const siblings = rows.filter((r) => parentOf.get(r.id) === parentId);
      const sent = new Set(orderedIds);
      // Bộ id phải khớp đúng anh em hiện có: danh sách admin đang xem đã cũ thì bảo tải lại thay vì ghi thứ tự lệch.
      if (sent.size !== orderedIds.length || sent.size !== siblings.length || siblings.some((s) => !sent.has(s.id))) {
        throw new ConflictException(CATEGORY_MSG.staleOrder());
      }
      const current = new Map(siblings.map((s) => [s.id, s.sortOrder]));
      for (const [index, id] of orderedIds.entries()) {
        if (current.get(id) !== index) await tx.category.update({ where: { id }, data: { sortOrder: index } });
      }
    });
    this.logger.log(`Admin ${adminId} sắp xếp lại ${orderedIds.length} danh mục ${parentId ? `con của ${parentId}` : 'gốc'}.`);
    return this.list();
  }

  async remove(adminId: string, id: string): Promise<{ id: string }> {
    await this.write(async (tx, rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundException(CATEGORY_MSG.notFound());
      const children = rows.filter((r) => r.parentId === id).length;
      if (children > 0) throw new BadRequestException(CATEGORY_MSG.removeHasChildren(row.name, children));
      const products = await tx.product.count({ where: { categoryIds: { has: id } } });
      if (products > 0) throw new BadRequestException(CATEGORY_MSG.removeHasProducts(row.name, products));
      await tx.category.delete({ where: { id } });
    });
    this.logger.warn(`Admin ${adminId} xoá danh mục ${id}.`);
    return { id };
  }

  /** Giữ khoá cây, đọc cây hiện tại trong cùng transaction rồi mới ghi; chỉ làm mới cache công khai khi đã commit. */
  private async write<T>(fn: (tx: Prisma.TransactionClient, rows: TreeRow[]) => Promise<T>): Promise<T> {
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_TREE_LOCK}))`;
      const rows = await tx.category.findMany({ select: TREE_SELECT, orderBy: [...TREE_ORDER] });
      return fn(tx, rows);
    });
    this.catalog.invalidateCategoryCache();
    this.home.invalidateStatic();
    return out;
  }

  private async rowOf(id: string): Promise<AdminCategoryRow> {
    const row = (await this.list()).items.find((i) => i.id === id);
    if (!row) throw new NotFoundException(CATEGORY_MSG.notFound());
    return row;
  }

  private cleanName(raw: string): string {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Tên danh mục không được để trống.');
    if (name.length > CATEGORY_NAME_MAX) throw new BadRequestException(`Tên danh mục tối đa ${CATEGORY_NAME_MAX} ký tự.`);
    return name;
  }

  /**
   * Gốc đang là lá mà còn sản phẩm gắn thẳng thì khi có con, các sản phẩm đó ở lại cha và không thuộc con nào. Không chặn cứng: con chưa
   * tồn tại thì không có chỗ chuyển sản phẩm xuống, nên lối duy nhất sẽ là gỡ rồi gán lại từng sản phẩm. Sản phẩm vẫn hiện ở trang của cha
   * (`categoryScope` gồm id cha), nên chỉ cần admin biết và đồng ý. Đếm trong transaction đang giữ khoá cây: gán ADD xen giữa không lọt.
   */
  private async assertDirectProductsConfirmed(tx: Prisma.TransactionClient, parent: TreeRow, confirmed: boolean | undefined): Promise<void> {
    if (confirmed) return;
    const n = await tx.product.count({ where: { categoryIds: { has: parent.id } } });
    if (n === 0) return;
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: CATEGORY_PARENT_HAS_PRODUCTS, message: CATEGORY_MSG.parentHasProducts(parent.name, n) });
  }

  /** `count` = số mục đang ở nhóm đích (gốc khi parentId null). */
  private assertRoom(rows: readonly TreeRow[], parentId: string | null, count: number): void {
    if (parentId === null) {
      if (count >= CATEGORY_MAX_ROOTS) throw new BadRequestException(CATEGORY_MSG.rootsFull());
      return;
    }
    if (count >= CATEGORY_MAX_CHILDREN) {
      throw new BadRequestException(CATEGORY_MSG.childrenFull(rows.find((r) => r.id === parentId)?.name ?? ''));
    }
  }

  private assertNameFree(name: string, siblings: readonly TreeRow[]): void {
    if (siblings.some((s) => sameCategoryName(s.name, name))) throw new BadRequestException(CATEGORY_MSG.duplicateName(name));
  }
}
