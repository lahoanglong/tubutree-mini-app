import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoryAiService, type StoryDraftResult } from '../ai-advisor/story-ai.service';
import type { StoryDraftInput } from '../ai-advisor/story-draft';
import { VARIATION_ORDER_BY } from './variation-order';

const MSG = { noProduct: 'Không tìm thấy sản phẩm.' } as const;

const garbledName = (name: string): boolean => name.trim() === '' || name.includes('[object Object]');

function ingredientList(raw: unknown): StoryDraftInput['ingredients'] {
  if (!Array.isArray(raw)) return [];
  const out: StoryDraftInput['ingredients'] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { name, benefit } = item as { name?: unknown; benefit?: unknown };
    if (typeof name === 'string' && name.trim() !== '') out.push({ name, benefit: typeof benefit === 'string' ? benefit : undefined });
  }
  return out;
}

/** Gom dữ liệu sản phẩm từ DB (không tin dữ liệu máy khách gửi lên) rồi nhờ AI soạn bản nháp kịch bản. Không ghi DB. */
@Injectable()
export class StoryDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: StoryAiService,
  ) {}

  async generate(productId: string, note: string | undefined): Promise<StoryDraftResult> {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        brand: true,
        shortDesc: true,
        description: true,
        ingredients: true,
        certifications: true,
        basePrice: true,
        salePrice: true,
        categoryIds: true,
        variations: { select: { name: true, retailPrice: true, salePrice: true }, orderBy: VARIATION_ORDER_BY },
      },
    });
    if (!p) throw new NotFoundException(MSG.noProduct);
    const categories = p.categoryIds.length > 0 ? await this.prisma.category.findMany({ where: { id: { in: p.categoryIds } }, select: { name: true } }) : [];

    return this.ai.draft({
      name: p.name,
      brand: p.brand,
      categories: categories.map((c) => c.name),
      price: p.salePrice ?? p.basePrice,
      // Tên phân loại hỏng (đồng bộ Pancake từng ghi "[object Object]") không đưa cho AI: chỉ làm nó viết sai quy cách.
      variations: p.variations.filter((v) => !garbledName(v.name)).map((v) => ({ name: v.name, price: v.salePrice ?? v.retailPrice })),
      shortDesc: p.shortDesc,
      description: p.description,
      ingredients: ingredientList(p.ingredients),
      certifications: p.certifications,
      note: note ?? '',
    });
  }
}
