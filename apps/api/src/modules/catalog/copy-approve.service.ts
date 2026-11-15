import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CopyApproveItem, CopyApproveResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { checkCopyForSave, COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { ingredientNames, mergeIngredients } from './ingredient-names';

const MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  partner: 'Sản phẩm của đối tác: đối tác tự sửa mô tả trong Cổng người bán, không sửa ở đây.',
  overCap: (before: number, added: number, cap: number) =>
    `Sản phẩm đã có ${before} thành phần, thêm ${added} tên mới sẽ thành ${before + added}, vượt trần ${cap}. Bớt tên mới đi, hoặc sửa danh sách thành phần ở trang sản phẩm.`,
} as const;

/**
 * Ghi bản mô tả admin đã duyệt từ bàn làm việc chất lượng catalog. Không tin bản gửi lên (admin có thể đã sửa tay): mỗi mục được kiểm lại bằng
 * đúng bộ chặn của bản nháp, còn tuyên bố cấm thì từ chối mục đó kèm câu bị chặn chứ không tự sửa. Các mục được nhận ghi trong MỘT transaction.
 * Cùng quy tắc với `ProductAdminService.update`: chỉ sản phẩm của Tubu (không phải của đối tác), mô tả đã trim, mô tả ngắn rỗng thành null.
 * Thành phần rỗng thì không đụng cột `ingredients`: duyệt bản nháp không có thành phần không được xoá thành phần admin đã nhập.
 * Thành phần có tên thì chỉ nối thêm tên mới vào các dòng hiện có (`mergeIngredients`), không ghi đè cả cột. Việc đọc-nối-ghi cột JSON nằm trong transaction
 * có khoá dòng `products` (FOR UPDATE, theo thứ tự id) và đọc lại cột SAU khi khoá, nên hai admin duyệt chồng nhau (hay duyệt chồng với "Bổ sung thành phần")
 * không ghi đè nhau. Trần 8 áp lên cột SAU khi nối như `IngredientEnrichService.save`: mục vượt trần bị từ chối kèm lý do, mục khác trong lô vẫn được ghi.
 */
@Injectable()
export class CopyApproveService {
  private readonly logger = new Logger(CopyApproveService.name);

  constructor(private readonly prisma: PrismaService) {}

  async approve(adminId: string, items: readonly CopyApproveItem[]): Promise<CopyApproveResponse> {
    const rows = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, name: true, storefrontId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const rejected: CopyApproveResponse['rejected'] = [];
    const accepted: { id: string; name: string; description: string; shortDesc: string; ingredients: string[] }[] = [];
    for (const item of items) {
      const row = byId.get(item.id);
      if (!row) {
        rejected.push({ id: item.id, reasons: [MSG.noProduct] });
        continue;
      }
      if (row.storefrontId !== null) {
        rejected.push({ id: item.id, reasons: [MSG.partner] });
        continue;
      }
      const check = checkCopyForSave(item);
      if (check.ok) accepted.push({ id: row.id, name: row.name, ...check.value });
      else rejected.push({ id: item.id, reasons: check.reasons });
    }

    const saved = new Set<string>();
    if (accepted.length > 0) {
      const ordered = [...accepted].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      await this.prisma.$transaction(async (tx) => {
        for (const a of ordered) {
          await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${a.id} FOR UPDATE`;
          const fresh = await tx.product.findUnique({ where: { id: a.id }, select: { storefrontId: true, ingredients: true } });
          if (!fresh) {
            rejected.push({ id: a.id, reasons: [MSG.noProduct] });
            continue;
          }
          if (fresh.storefrontId !== null) {
            rejected.push({ id: a.id, reasons: [MSG.partner] });
            continue;
          }
          let ingredients: Prisma.InputJsonValue | undefined;
          if (a.ingredients.length > 0) {
            const merged = mergeIngredients(fresh.ingredients, a.ingredients);
            const before = ingredientNames(fresh.ingredients).length;
            const after = ingredientNames(merged).length;
            if (after > before && after > COPY_INGREDIENTS_MAX) {
              rejected.push({ id: a.id, reasons: [MSG.overCap(before, after - before, COPY_INGREDIENTS_MAX)] });
              continue;
            }
            ingredients = merged as Prisma.InputJsonValue;
          }
          await tx.product.update({
            where: { id: a.id },
            data: { description: a.description, shortDesc: a.shortDesc === '' ? null : a.shortDesc, ...(ingredients ? { ingredients } : {}) },
            select: { id: true },
          });
          saved.add(a.id);
        }
      });
      for (const a of accepted) {
        if (saved.has(a.id)) this.logger.warn(`Admin ${adminId} duyệt mô tả sản phẩm ${a.id} (${a.name}): description, shortDesc${a.ingredients.length > 0 ? ', ingredients' : ''}`);
      }
    }
    return { saved: accepted.filter((a) => saved.has(a.id)).map((a) => a.id), rejected };
  }
}
