import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isRealUser } from '../../common/real-user';
import { FaqService } from '../faq/faq.service';
import { MAX_INPUT_CHARS } from './gateway-prompt';
import { LlmClient, LlmUnavailableException, type ChatMessage, type LlmFailureReason } from './llm.client';
import { productQueryTokens, rankProducts } from './product-match';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { publicImage } from '../../common/public-image';

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

interface FaqContext {
  category: string | null;
  question: string;
  answer: string;
}

const MAX_SUGGESTIONS = 5;
// Ứng viên lấy từ DB trước khi xếp hạng: đủ rộng để sản phẩm khớp nhiều từ nhất không bị cắt bởi thứ tự nổi bật.
const SUGGEST_CANDIDATES = 100;
const MAX_HISTORY = 6;
// Chặn phình token: chỉ nạp tối đa 20 FAQ (đã sắp theo sortOrder) vào system prompt.
const MAX_FAQ_IN_PROMPT = 20;
const OFFLINE_REPLY_WITH_PRODUCTS =
  'Trợ lý AI đang tạm nghỉ, bạn quay lại sau nhé! Trong lúc đó bạn có thể tham khảo vài sản phẩm gợi ý bên dưới 🌿';
const OFFLINE_REPLY_NO_MATCH =
  'Trợ lý AI đang tạm nghỉ, bạn quay lại sau nhé! Hiện chưa tìm thấy sản phẩm khớp câu hỏi: bạn thử gõ tên sản phẩm ngắn hơn (vd "nước rửa chén", "nước giặt") hoặc xem mục Sản phẩm nhé 🌿';

const SLOW_REPLY = 'Trợ lý AI đang phản hồi chậm, bạn thử lại sau ít phút nhé 🌿';
const BUSY_REPLY = 'Trợ lý AI đang có nhiều bạn hỏi cùng lúc, bạn thử lại sau ít phút nhé 🌿';
const USER_LIMIT_REPLY = 'Bạn đã hỏi khá nhiều trong giờ qua, mình xin phép nghỉ một chút, bạn quay lại sau nhé 🌿';
// Trần theo user ngoài 10 lượt/phút của controller: chặn một người đều đặn hỏi cả giờ làm cạn trần giờ của gateway.
const USER_PER_HOUR = 30;
const USER_WINDOW_MS = 60 * 60_000;
const USER_MAP_MAX = 5000;
// Tài khoản khách (guest_<deviceId>) tạo vô hạn bằng deviceId mới: gom chung một xô để một người xoay khách không làm cạn trần LLM dùng chung của khách thật.
const GUEST_PER_MIN = 10;
const GUEST_WINDOW_MS = 60_000;

/** Chỉ hứa "gợi ý bên dưới" khi thật sự có sản phẩm kèm theo. */
const offlineReply = (products: readonly ProductSuggestion[]): string =>
  products.length > 0 ? OFFLINE_REPLY_WITH_PRODUCTS : OFFLINE_REPLY_NO_MATCH;

/**
 * AI tư vấn 24/7 (§6.14.3). RAG-lite: tìm sản phẩm khớp câu hỏi trong catalog →
 * nhét vào system prompt để LLM chỉ gợi ý sản phẩm CÓ THẬT. Dùng LlmClient
 * (Antigravity gateway / DeepSeek / Gemini). Chưa cấu hình provider → trả lời graceful, vẫn kèm gợi ý sản phẩm.
 */
@Injectable()
export class AiAdvisorService {
  private readonly logger = new Logger(AiAdvisorService.name);

  // Bộ đếm trong bộ nhớ của một instance API (compose Vietnix chạy một instance); khởi động lại là về 0.
  private readonly userHits = new Map<string, { count: number; resetAt: number }>();

  private guestHits = { count: 0, resetAt: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
    private readonly faq: FaqService,
  ) {}

  async chat(userId: string, message: string, history: ChatMessage[] = []) {
    const text = (message ?? '').trim().slice(0, MAX_INPUT_CHARS);
    if (!text) throw new BadRequestException('Bạn chưa nhập câu hỏi.');

    const products = await this.suggestProducts(text);

    if (!this.llm.isConfigured()) {
      return { reply: offlineReply(products), products };
    }

    // Chỉ tốn round-trip DB lấy FAQ khi LLM thực sự được gọi (offline đã return ở trên).
    if (!this.allowUser(userId)) return { reply: USER_LIMIT_REPLY, products };

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
    if (!isRealUser(user) && !this.allowGuest()) {
      this.refundUser(userId);
      return { reply: BUSY_REPLY, products };
    }

    const faqs = await this.faq.listActive();

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(products, faqs.slice(0, MAX_FAQ_IN_PROMPT)) },
      ...history.slice(-MAX_HISTORY),
      { role: 'user', content: text },
    ];
    try {
      const reply = await this.llm.complete(messages);
      return { reply, products };
    } catch (e) {
      // Mọi provider cùng lỗi (LlmClient hết phương án) → fallback graceful thay vì để
      // ServiceUnavailableException tràn thành 503, giữ uptime cảm nhận được cho người dùng.
      // Chỉ ghi lý do, không ghi nội dung lỗi/câu hỏi: lỗi gateway có thể lặp lại lời khách.
      const reason: LlmFailureReason = e instanceof LlmUnavailableException ? e.reason : 'error';
      this.logger.error(`LLM tạm ngưng hoạt động (${reason}), fallback offline reply`);
      const reply = reason === 'timeout' ? SLOW_REPLY : reason === 'busy' ? BUSY_REPLY : offlineReply(products);
      return { reply, products };
    }
  }

  /** Lượt bị từ chối không gọi LLM nên không được tốn hạn mức giờ của người hỏi. */
  private refundUser(userId: string): void {
    const hit = this.userHits.get(userId);
    if (hit && hit.count > 0) hit.count -= 1;
  }

  private allowGuest(): boolean {
    const now = Date.now();
    if (this.guestHits.resetAt <= now) this.guestHits = { count: 0, resetAt: now + GUEST_WINDOW_MS };
    this.guestHits.count += 1;
    return this.guestHits.count <= GUEST_PER_MIN;
  }

  private allowUser(userId: string): boolean {
    const now = Date.now();
    if (this.userHits.size >= USER_MAP_MAX) {
      for (const [k, v] of this.userHits) if (v.resetAt <= now) this.userHits.delete(k);
      if (this.userHits.size >= USER_MAP_MAX) this.userHits.clear();
    }
    const hit = this.userHits.get(userId);
    if (!hit || hit.resetAt <= now) {
      this.userHits.set(userId, { count: 1, resetAt: now + USER_WINDOW_MS });
      return true;
    }
    hit.count += 1;
    return hit.count <= USER_PER_HOUR;
  }

  /**
   * RAG: tối đa 5 sản phẩm HIỆN CÔNG KHAI (cùng điều kiện với catalog, xem PUBLIC_PRODUCT_WHERE) khớp câu hỏi: kết quả
   * vào cả system prompt lẫn danh sách link khách bấm vào, nên SP chờ duyệt/bị từ chối không được lọt. Tra trên `nameSearch` (tên đã bỏ dấu, cùng cột với GET /products?q=)
   * nên gõ không dấu vẫn tìm được; từ đệm bị bỏ, sản phẩm chỉ khớp một từ chung bị loại, còn lại xếp theo số từ khớp.
   * DB chỉ lọc thô (chứa chuỗi con) và lấy ứng viên theo độ nổi bật; việc khớp nguyên từ + xếp hạng làm ở rankProducts.
   */
  private async suggestProducts(query: string): Promise<ProductSuggestion[]> {
    const tokens = productQueryTokens(query);
    if (tokens.length === 0) return [];
    const candidates = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, OR: tokens.map((t) => ({ nameSearch: { contains: t } })) },
      take: SUGGEST_CANDIDATES,
      orderBy: [{ isFeatured: 'desc' }, { ratingAvg: 'desc' }],
      select: { id: true, name: true, slug: true, brand: true, shortDesc: true, thumbnail: true, basePrice: true, salePrice: true },
    });
    return rankProducts(tokens, candidates, MAX_SUGGESTIONS).map((p) => ({ ...p, thumbnail: publicImage('product', p.id, 'thumb', p.thumbnail) }));
  }

  private systemPrompt(products: ProductSuggestion[], faqs: FaqContext[] = []): string {
    const catalog = products.length
      ? products
          .map((p) => `- ${p.name} (${p.brand}) — ${(p.salePrice ?? p.basePrice).toLocaleString('vi-VN')}đ${p.shortDesc ? ` · ${p.shortDesc}` : ''}`)
          .join('\n')
      : '(không tìm thấy sản phẩm khớp — gợi ý chung về tiêu dùng xanh)';

    const lines = [
      'Bạn là trợ lý tư vấn thân thiện của Tubu Tree — thương hiệu tiêu dùng xanh, sản phẩm sinh học an toàn cho gia đình và môi trường.',
      'Trả lời bằng tiếng Việt, ngắn gọn (2–4 câu), gần gũi, có thể dùng emoji nhẹ 🌿.',
      'CHỈ gợi ý sản phẩm trong danh sách dưới đây; nếu không phù hợp thì tư vấn chung và khuyên xem thêm ở mục Sản phẩm. Không bịa tên sản phẩm hay giá.',
      'Danh sách sản phẩm liên quan:',
      catalog,
    ];

    // Nạp FAQ (do admin quản lý) — ưu tiên trả lời nhất quán theo đây khi câu hỏi khớp chủ đề.
    if (faqs.length) {
      lines.push(
        'Câu hỏi thường gặp (ưu tiên trả lời theo đây):',
        faqs
          .map((f) => `- ${f.category ? `[${f.category}] ` : ''}Hỏi: ${f.question}\n  Đáp: ${f.answer}`)
          .join('\n'),
      );
    }

    return lines.join('\n');
  }
}
