import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { AnthropicCallError, postAnthropicMessage } from './anthropic.client';
import { buildCopyMessages, COPY_AI_MAX_TOKENS, composeCopyDraft, COPY_REASON, parseCopyReply, type CopyAiReply, type CopyDraftInput, type CopyDraftOutcome } from './copy-draft';
import { DEFAULT_CLAUDE_ADVISOR_MODEL } from './llm.client';

/**
 * Tổng thời gian chờ cho cả lô. Apache proxy cắt ở 60 giây (vhost API không đặt ProxyTimeout), còn phải chừa chỗ cho truy vấn DB
 * trước đó và gửi JSON về, nên dừng gọi AI ở 50 giây: sản phẩm chưa kịp bắt đầu dùng chữ dự phòng thay vì kéo cả lô quá hạn.
 */
export const COPY_AI_BUDGET_MS = 50_000;
/** Mỗi lượt gọi tối đa chừng này; một lượt treo không được nuốt hết ngân sách của các sản phẩm còn lại. */
export const COPY_AI_CALL_CAP_MS = 20_000;
/** Còn dưới mức này thì không mở lượt mới: Haiku không thể trả JSON trong chừng đó. */
export const COPY_AI_MIN_SLICE_MS = 5_000;
export const COPY_AI_PARALLEL = 3;
/** Số lô chạy cùng lúc. Một lô giữ tới 3 kết nối 20-50 giây và tốn tiền, nên chỉ cho một. */
export const COPY_AI_MAX_CONCURRENT = 1;

export const COPY_AI_MSG = { busy: 'Đang soạn mô tả cho một lô khác. Thử lại sau ít phút.' } as const;

/**
 * AI soạn mô tả, mô tả ngắn và thành phần cho bàn làm việc chất lượng catalog (admin). Gọi Claude Haiku qua cùng ANTHROPIC_API_KEY với AI tư vấn khách,
 * model đổi bằng AI_ADVISOR_CLAUDE_MODEL. Không ghi DB: kết quả chỉ là bản nháp để admin xem rồi duyệt.
 * Chưa có khoá, 429/529, hết giờ, lỗi hay JSON hỏng đều rơi về chữ dự phòng đã duyệt (xem `composeCopyDraft`), không làm hỏng cả lô.
 * Log chỉ mang loại lỗi, không bao giờ mang prompt, lời model hay khoá.
 */
@Injectable()
export class CopyAiService {
  private readonly logger = new Logger(CopyAiService.name);
  private readonly key: string;
  private readonly model: string;
  private inFlight = 0;

  constructor(config: ConfigService<Env, true>) {
    this.key = (config.get('ANTHROPIC_API_KEY', { infer: true }) ?? '').trim();
    this.model = (config.get('AI_ADVISOR_CLAUDE_MODEL', { infer: true }) ?? '').trim() || DEFAULT_CLAUDE_ADVISOR_MODEL;
  }

  isConfigured(): boolean {
    return this.key.length > 0;
  }

  /** Kết quả cùng thứ tự `inputs`. Ném 503 khi đã có một lô đang chạy. */
  async draftBatch(inputs: readonly CopyDraftInput[]): Promise<CopyDraftOutcome[]> {
    if (!this.isConfigured()) return inputs.map((i) => composeCopyDraft(i, null, COPY_REASON.notConfigured));
    if (this.inFlight >= COPY_AI_MAX_CONCURRENT) {
      this.logger.warn('Đã có lô soạn mô tả đang chạy, bỏ qua lô này.');
      throw new ServiceUnavailableException(COPY_AI_MSG.busy);
    }

    this.inFlight += 1;
    try {
      const startedAt = Date.now();
      const out: CopyDraftOutcome[] = new Array<CopyDraftOutcome>(inputs.length);
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const idx = next++;
          const input = inputs[idx];
          if (!input) return;
          const remaining = COPY_AI_BUDGET_MS - (Date.now() - startedAt);
          if (remaining < COPY_AI_MIN_SLICE_MS) {
            out[idx] = composeCopyDraft(input, null, COPY_REASON.budget);
            continue;
          }
          const { reply, reason } = await this.ask(input, Math.min(COPY_AI_CALL_CAP_MS, remaining));
          out[idx] = composeCopyDraft(input, reply, reason);
        }
      };
      await Promise.all(Array.from({ length: Math.min(COPY_AI_PARALLEL, inputs.length) }, worker));
      return out;
    } finally {
      this.inFlight -= 1;
    }
  }

  private async ask(input: CopyDraftInput, timeoutMs: number): Promise<{ reply: CopyAiReply | null; reason: string }> {
    const { system, user } = buildCopyMessages(input);
    try {
      // Không gửi `output_config.effort`: Haiku 4.5 trả 400. Không gửi temperature/top_p: model do admin đổi qua AI_ADVISOR_CLAUDE_MODEL có thể từ chối.
      const { text, stopReason } = await postAnthropicMessage({
        key: this.key,
        model: this.model,
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: COPY_AI_MAX_TOKENS,
        timeoutMs,
      });
      // max_tokens: JSON cụt giữa chừng; refusal: model từ chối. Cả hai đều không phải bản nháp dùng được.
      if (stopReason !== undefined && stopReason !== 'end_turn') {
        this.logger.warn(`Soạn mô tả: Claude dừng sớm (${stopReason.slice(0, 30)}).`);
        return { reply: null, reason: COPY_REASON.unusable };
      }
      const reply = parseCopyReply(text);
      if (!reply) this.logger.warn('Soạn mô tả: Claude trả JSON không dựng được.');
      return { reply, reason: COPY_REASON.unusable };
    } catch (e) {
      const kind = e instanceof AnthropicCallError ? e.kind : 'error';
      this.logger.warn(`Soạn mô tả: Claude lỗi (${kind}).`);
      return { reply: null, reason: kind === 'busy' ? COPY_REASON.busy : kind === 'timeout' ? COPY_REASON.timeout : COPY_REASON.error };
    }
  }
}
