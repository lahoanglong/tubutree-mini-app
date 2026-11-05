import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AnthropicClient } from './anthropic.client';
import { LlmClient } from './llm.client';
import { buildStoryDraftMessages, parseStoryDraft, STORY_DRAFT_MAX_TOKENS, type StoryDraft, type StoryDraftInput } from './story-draft';

export type StoryDraftProvider = 'antigravity' | 'anthropic' | 'deepseek' | 'gemini';

export interface StoryDraftResult extends StoryDraft {
  provider: StoryDraftProvider;
}

/**
 * Tổng thời gian chờ cho một lượt soạn. Phải ngắn hơn hạn đọc 60 giây mặc định của Apache (vhost API không đặt ProxyTimeout) và
 * ngắn hơn hạn 65 giây của trang admin (STORY_DRAFT_TIMEOUT_MS), để admin nhận được bản nháp hoặc lời báo lỗi thay vì bị ngắt giữa chừng.
 */
export const STORY_AI_BUDGET_MS = 55_000;
/** Còn dưới mức này thì không mở thêm provider: một lượt gọi AI không thể xong trong chừng đó. */
export const STORY_AI_MIN_SLICE_MS = 8_000;
/** Antigravity là đường miễn phí và thường nhanh; chậm hơn mức này thì nhường phần ngân sách còn lại cho Claude. */
export const STORY_AI_GATEWAY_CAP_MS = 20_000;
/** Số lượt soạn chạy cùng lúc. Mỗi lượt giữ một kết nối tới nhà cung cấp 20-50 giây và tốn tiền, nên chỉ cho hai. */
export const STORY_AI_MAX_CONCURRENT = 2;

export const STORY_AI_MSG = {
  notConfigured: 'Chưa cấu hình AI nào để soạn kịch bản. Soạn tay trong Story Studio hoặc nhờ kỹ thuật cấu hình.',
  failed: 'AI chưa soạn được kịch bản lần này. Thử lại sau ít phút hoặc soạn tay.',
  busy: 'AI đang soạn kịch bản cho người khác. Thử lại sau ít phút.',
} as const;

/**
 * AI soạn kịch bản câu chuyện cho Story Studio. Thứ tự: antigravity (miễn phí) > Claude trực tiếp > deepseek > gemini, chỉ thử provider đã cấu hình.
 * Provider lỗi, hết giờ, hay trả JSON không dựng được kịch bản thì sang provider kế. Không ghi gì vào DB: kết quả chỉ là bản nháp để admin xem trước và bấm Lưu.
 * Có cổng đồng thời riêng, không dùng chung trần của AI tư vấn khách: soạn kịch bản chậm và đắt, không được chiếm chỗ của khách đang hỏi.
 * Log chỉ mang tên provider và loại lỗi, không bao giờ mang prompt, câu trả lời của model hay khoá.
 */
@Injectable()
export class StoryAiService {
  private readonly logger = new Logger(StoryAiService.name);
  private inFlight = 0;

  constructor(
    private readonly llm: LlmClient,
    private readonly anthropic: AnthropicClient,
  ) {}

  async draft(input: StoryDraftInput): Promise<StoryDraftResult> {
    const messages = buildStoryDraftMessages(input);
    const system = messages[0]!.content;
    const user = messages[1]!.content;
    const base = { maxTokens: STORY_DRAFT_MAX_TOKENS, rawGatewayPrompt: true };

    const chain: { provider: StoryDraftProvider; cap: number; run: (timeoutMs: number) => Promise<string> }[] = [];
    if (this.llm.hasProvider('antigravity')) {
      chain.push({ provider: 'antigravity', cap: STORY_AI_GATEWAY_CAP_MS, run: (timeoutMs) => this.llm.completeVia(['antigravity'], messages, { ...base, timeoutMs }) });
    }
    if (this.anthropic.isConfigured()) {
      chain.push({ provider: 'anthropic', cap: STORY_AI_BUDGET_MS, run: (timeoutMs) => this.anthropic.complete(system, user, STORY_DRAFT_MAX_TOKENS, timeoutMs) });
    }
    for (const p of ['deepseek', 'gemini'] as const) {
      if (this.llm.hasProvider(p)) chain.push({ provider: p, cap: STORY_AI_BUDGET_MS, run: (timeoutMs) => this.llm.completeVia([p], messages, { ...base, timeoutMs }) });
    }
    if (chain.length === 0) throw new ServiceUnavailableException(STORY_AI_MSG.notConfigured);
    if (this.inFlight >= STORY_AI_MAX_CONCURRENT) {
      this.logger.warn('Đã đủ lượt soạn kịch bản chạy cùng lúc, bỏ qua lượt này.');
      throw new ServiceUnavailableException(STORY_AI_MSG.busy);
    }

    this.inFlight += 1;
    try {
      const startedAt = Date.now();
      for (const { provider, cap, run } of chain) {
        const remaining = STORY_AI_BUDGET_MS - (Date.now() - startedAt);
        if (remaining < STORY_AI_MIN_SLICE_MS) break;
        try {
          return { ...parseStoryDraft(await run(Math.min(cap, remaining)), input), provider };
        } catch (e) {
          this.logger.warn(`Soạn kịch bản bằng ${provider} không được: ${(e as Error).message}`);
        }
      }
      throw new ServiceUnavailableException(STORY_AI_MSG.failed);
    } finally {
      this.inFlight -= 1;
    }
  }
}
