import { Injectable } from '@nestjs/common';
import type { CopyDraft, CopyDraftsResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CopyAiService } from '../ai-advisor/copy-ai.service';
import type { CopyDraftInput, CopyDraftOutcome } from '../ai-advisor/copy-draft';
import { ingredientNames } from './ingredient-names';
import { VARIATION_ORDER_BY } from './variation-order';

const MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  partner: 'Sản phẩm của đối tác: đối tác tự soạn mô tả trong Cổng người bán, không soạn ở đây.',
} as const;

const garbledName = (name: string): boolean => name.trim() === '' || name.includes('[object Object]');

/**
 * Gom dữ liệu sản phẩm từ DB theo id (không tin gì máy khách gửi ngoài danh sách id) rồi nhờ AI soạn bản nháp mô tả, mô tả ngắn và thành phần.
 * Không ghi DB: admin xem trước rồi mới gọi duyệt (`CopyApproveService`). Sản phẩm không có hoặc của đối tác vào `failed`, không làm hỏng cả lô.
 */
@Injectable()
export class CopyDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: CopyAiService,
  ) {}

  async generate(ids: readonly string[]): Promise<CopyDraftsResponse> {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        slug: true,
        name: true,
        brand: true,
        shortDesc: true,
        description: true,
        ingredients: true,
        categoryIds: true,
        storefrontId: true,
        variations: { select: { name: true }, orderBy: VARIATION_ORDER_BY },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const eligible = rows.filter((r) => r.storefrontId === null);

    const categoryIds = [...new Set(eligible.flatMap((r) => r.categoryIds))];
    const categories = categoryIds.length > 0 ? await this.prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : [];
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));

    const inputs: CopyDraftInput[] = eligible.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      categories: r.categoryIds.flatMap((c) => categoryName.get(c) ?? []),
      // Tên phân loại hỏng (đồng bộ Pancake từng ghi "[object Object]") không đưa cho AI: chỉ làm nó viết sai quy cách.
      variations: r.variations.map((v) => v.name).filter((n) => !garbledName(n)),
      shortDesc: r.shortDesc,
      description: r.description,
      ingredients: ingredientNames(r.ingredients),
    }));

    const outcomes = new Map<string, CopyDraftOutcome>();
    if (inputs.length > 0) for (const o of await this.ai.draftBatch(inputs)) outcomes.set(o.id, o);

    const drafts: CopyDraft[] = [];
    const failed: CopyDraftsResponse['failed'] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        failed.push({ id, reason: MSG.noProduct });
        continue;
      }
      if (row.storefrontId !== null) {
        failed.push({ id, reason: MSG.partner });
        continue;
      }
      const o = outcomes.get(id);
      if (o && 'draft' in o) drafts.push(o.draft);
      else failed.push({ id, reason: o ? o.failed : MSG.noProduct });
    }
    return { drafts, failed };
  }
}
