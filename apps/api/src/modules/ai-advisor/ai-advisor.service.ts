import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmClient, type ChatMessage } from './llm.client';

export interface ProductSuggestion {
  id: string;
  name: string;
  slug: string;
  brand: string;
  shortDesc: string | null;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
}

const MAX_HISTORY = 6;
const OFFLINE_REPLY =
  'Trợ lý AI đang tạm nghỉ, bạn quay lại sau nhé! Trong lúc đó bạn có thể tham khảo vài sản phẩm gợi ý bên dưới 🌿';

/**
 * AI tư vấn 24/7 (§6.14.3). RAG-lite: tìm sản phẩm khớp câu hỏi trong catalog →
 * nhét vào system prompt để LLM chỉ gợi ý sản phẩm CÓ THẬT. Dùng LlmClient
 * (DeepSeek + Gemini). Chưa cấu hình key → trả lời graceful, vẫn kèm gợi ý sản phẩm.
 */
@Injectable()
export class AiAdvisorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
  ) {}

  async chat(userId: string, message: string, history: ChatMessage[] = []) {
    const text = (message ?? '').trim();
    if (!text) throw new BadRequestException('Bạn chưa nhập câu hỏi.');

    const products = await this.suggestProducts(text);

    if (!this.llm.isConfigured()) {
      return { reply: OFFLINE_REPLY, products };
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(products) },
      ...history.slice(-MAX_HISTORY),
      { role: 'user', content: text },
    ];
    const reply = await this.llm.complete(messages);
    return { reply, products };
  }

  /** RAG: tìm tối đa 5 sản phẩm ACTIVE khớp bất kỳ token nào trong câu hỏi (theo tên). */
  private async suggestProducts(query: string): Promise<ProductSuggestion[]> {
    const tokens = Array.from(
      new Set(
        query
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 3),
      ),
    ).slice(0, 8);
    if (tokens.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { isActive: true, OR: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })) },
      take: 5,
      orderBy: [{ isFeatured: 'desc' }, { ratingAvg: 'desc' }],
      select: { id: true, name: true, slug: true, brand: true, shortDesc: true, thumbnail: true, basePrice: true, salePrice: true },
    });
    return products;
  }

  private systemPrompt(products: ProductSuggestion[]): string {
    const catalog = products.length
      ? products
          .map((p) => `- ${p.name} (${p.brand}) — ${(p.salePrice ?? p.basePrice).toLocaleString('vi-VN')}đ${p.shortDesc ? ` · ${p.shortDesc}` : ''}`)
          .join('\n')
      : '(không tìm thấy sản phẩm khớp — gợi ý chung về tiêu dùng xanh)';
    return [
      'Bạn là trợ lý tư vấn thân thiện của Tubu Tree — thương hiệu tiêu dùng xanh, sản phẩm sinh học an toàn cho gia đình và môi trường.',
      'Trả lời bằng tiếng Việt, ngắn gọn (2–4 câu), gần gũi, có thể dùng emoji nhẹ 🌿.',
      'CHỈ gợi ý sản phẩm trong danh sách dưới đây; nếu không phù hợp thì tư vấn chung và khuyên xem thêm ở mục Sản phẩm. Không bịa tên sản phẩm hay giá.',
      'Danh sách sản phẩm liên quan:',
      catalog,
    ].join('\n');
  }
}
