import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { IngredientsFromImageResponse, IngredientsSaveResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { checkIngredientsForSave, COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { checkOcrImage } from '../ai-advisor/ingredient-ocr';
import { IngredientOcrService } from '../ai-advisor/ingredient-ocr.service';
import { ingredientNames, mergeIngredients } from './ingredient-names';

export const ENRICH_MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  partner: 'Sản phẩm của đối tác: đối tác tự sửa thành phần trong Cổng người bán, không sửa ở đây.',
  unreadable: 'Không đọc được mục Thành phần trên ảnh. Chụp lại mặt sau bao bì rõ nét, đủ sáng, rồi thử lại, hoặc nhập tay.',
  overCap: (before: number, added: number, cap: number) =>
    `Sản phẩm đã có ${before} thành phần, thêm ${added} tên mới sẽ thành ${before + added}, vượt trần ${cap}. Bớt tên mới đi, hoặc sửa danh sách thành phần ở trang sản phẩm.`,
} as const;

/**
 * Bổ sung thành phần cho sản phẩm của Tubu (admin): nhờ AI đọc ảnh nhãn bao bì ra BẢN NHÁP, rồi lưu bản admin đã xem. `extract` không bao giờ ghi DB.
 * `save` chỉ NỐI thêm tên mới vào cột `ingredients` (`mergeIngredients`: giữ nguyên dòng đã có kèm percentage/benefit) và dùng đúng bộ chặn của duyệt mô tả
 * (`checkIngredientsForSave`): trần 8 tên, 80 ký tự mỗi tên, không mã HTML, không công dụng y tế hay chứng nhận. Trần 8 cũng áp lên cột SAU khi nối (tên đã có + tên mới): vượt thì 400, không cắt lặng lẽ.
 * Đọc-nối-ghi nằm trong một `$transaction` có khoá dòng `products` (FOR UPDATE). Sản phẩm của đối tác không sửa ở đây.
 */
@Injectable()
export class IngredientEnrichService {
  private readonly logger = new Logger(IngredientEnrichService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: IngredientOcrService,
  ) {}

  async extract(id: string, image: string): Promise<IngredientsFromImageResponse> {
    const checked = checkOcrImage(image);
    if (!checked.ok) throw new BadRequestException(checked.reason);
    const row = await this.load(id);

    const reply = await this.ocr.read(checked.image, row.name);
    if (!reply.readable) return { id, readable: false, ingredients: [], warnings: [ENRICH_MSG.unreadable] };

    // Trả đủ tên đọc được, kể cả tên bộ chặn sẽ từ chối lúc lưu: admin cần thấy chữ gốc trên nhãn để sửa, còn cảnh báo cho biết chỗ phải sửa.
    const check = checkIngredientsForSave(reply.ingredients);
    return { id, readable: true, ingredients: reply.ingredients, warnings: check.ok ? [] : check.reasons };
  }

  async save(adminId: string, id: string, names: readonly string[]): Promise<IngredientsSaveResponse> {
    const check = checkIngredientsForSave(names);
    if (!check.ok) throw new BadRequestException(check.reasons.join(' '));

    const result = await this.prisma.$transaction(async (tx) => {
      // Đọc-nối-ghi cột JSON phải nằm trong một giao dịch có khoá dòng: hai admin lưu cùng lúc không được ghi đè lên nhau.
      await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${id} FOR UPDATE`;
      const row = await this.load(id, tx);

      const merged = mergeIngredients(row.ingredients, check.value);
      const after = ingredientNames(merged);
      const before = ingredientNames(row.ingredients).length;
      const added = after.length - before;
      if (added > 0 && after.length > COPY_INGREDIENTS_MAX) throw new BadRequestException(ENRICH_MSG.overCap(before, added, COPY_INGREDIENTS_MAX));
      if (added > 0) await tx.product.update({ where: { id }, data: { ingredients: merged as Prisma.InputJsonValue }, select: { id: true } });
      return { name: row.name, after, added };
    });

    if (result.added > 0) this.logger.warn(`Admin ${adminId} bổ sung ${result.added} thành phần cho sản phẩm ${id} (${result.name}).`);
    return { id, ingredients: result.after, added: result.added };
  }

  private async load(id: string, db: Pick<Prisma.TransactionClient, 'product'> = this.prisma): Promise<{ id: string; name: string; storefrontId: string | null; ingredients: unknown }> {
    const row = await db.product.findUnique({ where: { id }, select: { id: true, name: true, storefrontId: true, ingredients: true } });
    if (!row) throw new NotFoundException(ENRICH_MSG.noProduct);
    if (row.storefrontId !== null) throw new ConflictException(ENRICH_MSG.partner);
    return row;
  }
}
