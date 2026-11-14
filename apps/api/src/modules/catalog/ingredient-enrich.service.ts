import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { IngredientsFromImageResponse, IngredientsSaveResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { checkIngredientsForSave } from '../ai-advisor/copy-draft';
import { checkOcrImage } from '../ai-advisor/ingredient-ocr';
import { IngredientOcrService } from '../ai-advisor/ingredient-ocr.service';
import { ingredientNames, mergeIngredients } from './ingredient-names';

export const ENRICH_MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  partner: 'Sản phẩm của đối tác: đối tác tự sửa thành phần trong Cổng người bán, không sửa ở đây.',
  unreadable: 'Không đọc được mục Thành phần trên ảnh. Chụp lại mặt sau bao bì rõ nét, đủ sáng, rồi thử lại, hoặc nhập tay.',
} as const;

/**
 * Bổ sung thành phần cho sản phẩm của Tubu (admin): nhờ AI đọc ảnh nhãn bao bì ra BẢN NHÁP, rồi lưu bản admin đã xem. `extract` không bao giờ ghi DB.
 * `save` chỉ NỐI thêm tên mới vào cột `ingredients` (`mergeIngredients`: giữ nguyên dòng đã có kèm percentage/benefit) và dùng đúng bộ chặn của duyệt mô tả
 * (`checkIngredientsForSave`): trần 8 tên, 80 ký tự mỗi tên, không mã HTML, không công dụng y tế hay chứng nhận. Sản phẩm của đối tác không sửa ở đây.
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
    const row = await this.load(id);

    const merged = mergeIngredients(row.ingredients, check.value);
    const after = ingredientNames(merged);
    const added = after.length - ingredientNames(row.ingredients).length;
    if (added > 0) {
      await this.prisma.product.update({ where: { id }, data: { ingredients: merged as Prisma.InputJsonValue }, select: { id: true } });
      this.logger.warn(`Admin ${adminId} bổ sung ${added} thành phần cho sản phẩm ${id} (${row.name}).`);
    }
    return { id, ingredients: after, added };
  }

  private async load(id: string): Promise<{ id: string; name: string; storefrontId: string | null; ingredients: unknown }> {
    const row = await this.prisma.product.findUnique({ where: { id }, select: { id: true, name: true, storefrontId: true, ingredients: true } });
    if (!row) throw new NotFoundException(ENRICH_MSG.noProduct);
    if (row.storefrontId !== null) throw new ConflictException(ENRICH_MSG.partner);
    return row;
  }
}
