import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AnthropicClient } from './anthropic.client';
import { LlmClient } from './llm.client';
import { buildStoryDraftMessages, parseStoryDraft, STORY_DRAFT_MAX_TOKENS, type StoryDraft, type StoryDraftInput } from './story-draft';

export type StoryDraftProvider = 'antigravity' | 'anthropic' | 'deepseek' | 'gemini';

export interface StoryDraftResult extends StoryDraft {
  provider: StoryDraftProvider;
}

/** Quá mốc này mà chưa có bản nháp thì thôi, không mở thêm provider: admin đang chờ trên màn hình và proxy có hạn đọc. */
export const STORY_AI_BUDGET_MS = 100_000;

export const STORY_AI_MSG = {
  notConfigured: 'Chưa cấu hình AI nào để soạn kịch bản. Soạn tay trong Story Studio hoặc nhờ kỹ thuật cấu hình.',
  failed: 'AI chưa soạn được kịch bản lần này. Thử lại sau ít phút hoặc soạn tay.',
} as const;

/**
 * AI soạn kịch bản câu chuyện cho Story Studio. Thứ tự: antigravity (miễn phí) > Claude trực tiếp > deepseek > gemini, chỉ thử provider đã cấu hình.
 * Provider lỗi, hết giờ, hay trả JSON không dựng được kịch bản thì sang provider kế. Không ghi gì vào DB: kết quả chỉ là bản nháp để admin xem trước và bấm Lưu.
 * Log chỉ mang tên provider và loại lỗi, không bao giờ mang prompt, câu trả lời của model hay khoá.
 */
@Injectable()
export class StoryAiService {
  private readonly logger = new Logger(StoryAiService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly anthropic: AnthropicClient,
  ) {}

  async draft(input: StoryDraftInput): Promise<StoryDraftResult> {
    const messages = buildStoryDraftMessages(input);
    const system = messages[0]!.content;
    const user = messages[1]!.content;
    const opts = { maxTokens: STORY_DRAFT_MAX_TOKENS, rawGatewayPrompt: true };

    const chain: { provider: StoryDraftProvider; run: () => Promise<string> }[] = [];
    if (this.llm.hasProvider('antigravity')) chain.push({ provider: 'antigravity', run: () => this.llm.completeVia(['antigravity'], messages, opts) });
    if (this.anthropic.isConfigured()) chain.push({ provider: 'anthropic', run: () => this.anthropic.complete(system, user, STORY_DRAFT_MAX_TOKENS) });
    for (const p of ['deepseek', 'gemini'] as const) {
      if (this.llm.hasProvider(p)) chain.push({ provider: p, run: () => this.llm.completeVia([p], messages, opts) });
    }
    if (chain.length === 0) throw new ServiceUnavailableException(STORY_AI_MSG.notConfigured);

    const startedAt = Date.now();
    for (const { provider, run } of chain) {
      if (Date.now() - startedAt >= STORY_AI_BUDGET_MS) break;
      try {
        return { ...parseStoryDraft(await run(), input), provider };
      } catch (e) {
        this.logger.warn(`Soạn kịch bản bằng ${provider} không được: ${(e as Error).message}`);
      }
    }
    throw new ServiceUnavailableException(STORY_AI_MSG.failed);
  }
}
