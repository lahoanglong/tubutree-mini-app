import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CopyApproveItem, CopyApproveResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { checkCopyForSave } from '../ai-advisor/copy-draft';
import { mergeIngredients } from './ingredient-names';

const MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  partner: 'Sản phẩm của đối tác: đối tác tự sửa mô tả trong Cổng người bán, không sửa ở đây.',
} as const;

/**
 * Ghi bản mô tả admin đã duyệt từ bàn làm việc chất lượng catalog. Không tin bản gửi lên (admin có thể đã sửa tay): mỗi mục được kiểm lại bằng
 * đúng bộ chặn của bản nháp, còn tuyên bố cấm thì từ chối mục đó kèm câu bị chặn chứ không tự sửa. Các mục được nhận ghi trong MỘT transaction.
 * Cùng quy tắc với `ProductAdminService.update`: chỉ sản phẩm của Tubu (không phải của đối tác), mô tả đã trim, mô tả ngắn rỗng thành null.
 * Thành phần rỗng thì không đụng cột `ingredients`: duyệt bản nháp không có thành phần không được xoá thành phần admin đã nhập.
 * Thành phần có tên thì chỉ nối thêm tên mới vào các dòng hiện có (`mergeIngredients`), không ghi đè cả cột.
 */
@Injectable()
export class CopyApproveService {
  private readonly logger = new Logger(CopyApproveService.name);

  constructor(private readonly prisma: PrismaService) {}

  async approve(adminId: string, items: readonly CopyApproveItem[]): Promise<CopyApproveResponse> {
    const rows = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, name: true, storefrontId: true, ingredients: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const rejected: CopyApproveResponse['rejected'] = [];
    const accepted: { id: string; name: string; description: string; shortDesc: string; ingredients: string[]; currentIngredients: unknown }[] = [];
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
      if (check.ok) accepted.push({ id: row.id, name: row.name, currentIngredients: row.ingredients, ...check.value });
      else rejected.push({ id: item.id, reasons: check.reasons });
    }

    if (accepted.length > 0) {
      await this.prisma.$transaction(
        accepted.map((a) =>
          this.prisma.product.update({
            where: { id: a.id },
            data: {
              description: a.description,
              shortDesc: a.shortDesc === '' ? null : a.shortDesc,
              ...(a.ingredients.length > 0 ? { ingredients: mergeIngredients(a.currentIngredients, a.ingredients) as Prisma.InputJsonValue } : {}),
            },
            select: { id: true },
          }),
        ),
      );
      for (const a of accepted) {
        this.logger.warn(`Admin ${adminId} duyệt mô tả sản phẩm ${a.id} (${a.name}): description, shortDesc${a.ingredients.length > 0 ? ', ingredients' : ''}`);
      }
    }
    return { saved: accepted.map((a) => a.id), rejected };
  }
}
