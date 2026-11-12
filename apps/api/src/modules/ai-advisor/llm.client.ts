import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.validation';
import {
  ADVISOR_PROVIDERS,
  type AdvisorProvider,
  isAdvisorAvailable,
  positiveInt,
  providerConfigured,
  resolveProviderOrder,
} from './advisor-config';
import { AnthropicCallError, type AnthropicTurn, postAnthropicMessage } from './anthropic.client';
import { buildGatewayPrompt } from './gateway-prompt';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteViaOptions {
  /** Trần token đầu ra cho provider OpenAI-compatible (mặc định 800 là đủ cho câu trả lời tư vấn, không đủ cho JSON kịch bản). */
  maxTokens?: number;
  /**
   * Gateway: dùng nguyên văn các tin nhắn nối lại thay vì khung "câu hỏi của khách" của AI tư vấn (khung đó cắt còn 500 ký tự
   * và dặn trả lời như tư vấn viên). Chỉ dùng với nội dung do admin gửi, không bao giờ với chữ của khách.
   */
  rawGatewayPrompt?: boolean;
  /** Hạn chờ tối đa cho lượt gọi này (mili giây); gateway vẫn không vượt ANTIGRAVITY_GATEWAY_TIMEOUT_MS, provider chat thay mặc định 30 giây. */
  timeoutMs?: number;
}

/** Lý do thất bại để service chọn câu xin lỗi phù hợp; KHÔNG mang nội dung lỗi của gateway ra ngoài. */
export type LlmFailureReason = 'timeout' | 'busy' | 'error';

export class LlmUnavailableException extends ServiceUnavailableException {
  constructor(readonly reason: LlmFailureReason) {
    super('AI tư vấn tạm thời chưa khả dụng.');
  }
}

class LlmCallError extends Error {
  constructor(
    message: string,
    readonly reason: LlmFailureReason,
    // Chỉ để nhận diện lỗi (vd model bị gỡ), không đưa vào log: thông điệp gateway có thể lặp lại nội dung khách hỏi.
    readonly detail = '',
  ) {
    super(message);
  }
}

const GATEWAY_TASK = 'tubutree';
const DEFAULT_ANTIGRAVITY_MODEL = 'gemini-3.8-flash-high';
// Haiku: rẻ và nhanh cho câu tư vấn 2-4 câu; đổi bằng AI_ADVISOR_CLAUDE_MODEL, độc lập với CLAUDE_API_MODEL của Story Studio.
const DEFAULT_CLAUDE_ADVISOR_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_CLAUDE_MAX_TOKENS = 800;
// Mini App bỏ chờ sau 15 giây: Claude chậm hơn mức này thì khách đã thấy lỗi chung, câu xin lỗi và provider dự phòng không tới được họ.
const DEFAULT_CLAUDE_TIMEOUT_MS = 12_000;
// Phải dài hơn timeout nội bộ của agy trong gateway (60s theo ChoDeli) thì mới nhận được JSON {error:"timeout"}
// gọn thay vì bị ngắt socket; nhưng khách đang chờ nên mặc định ngắn hơn, chấp nhận ngắt sớm và hiện câu xin lỗi.
const DEFAULT_ANTIGRAVITY_TIMEOUT_MS = 45_000;
const DEFAULT_GLOBAL_PER_MIN = 40;
// Mỗi lượt agy khởi động một tiến trình (p50 ~13s ở ChoDeli): gọi song song nhiều thì gateway tự từ chối 429.
const DEFAULT_MAX_CONCURRENT = 3;
const RATE_WINDOW_MS = 60_000;

/**
 * Client LLM cho AI tư vấn (§6.14.3). Antigravity gateway (chính, cùng cách ChoDeli dùng) → Claude trực tiếp (Haiku) → Gemini → DeepSeek,
 * chỉ thử những provider đã cấu hình; AI_ADVISOR_PROVIDER chọn cứng một provider (xem advisor-config.ts).
 * Gate bằng cấu hình: tắt hoặc chưa có provider nào → isConfigured()=false để service tắt graceful.
 * Provider `claude` gọi Messages API bằng ANTHROPIC_API_KEY chung với Story Studio nhưng model riêng (AI_ADVISOR_CLAUDE_MODEL). Story Studio của admin
 * có thứ tự riêng (antigravity > Claude > deepseek/gemini) nên gọi `completeVia()` cho từng provider và tự ghép Claude của nó (AnthropicClient).
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly deepseekKey: string;
  private readonly deepseekBase: string;
  private readonly deepseekModel: string;
  private readonly geminiKey: string;
  private readonly geminiBase: string;
  private readonly geminiModel: string;
  private readonly gatewayUrl: string;
  private readonly gatewayKey: string;
  private readonly gatewayModel: string;
  private readonly gatewayTimeoutMs: number;
  private readonly claudeKey: string;
  private readonly claudeModel: string;
  private readonly order: AdvisorProvider[];
  private readonly configured: ReadonlySet<AdvisorProvider>;
  private readonly available: boolean;
  private readonly globalPerMin: number;
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private windowStart = 0;
  private windowCount = 0;

  constructor(config: ConfigService<Env, true>) {
    const get = (k: string) => config.get(k as keyof Env, { infer: true }) as string | undefined;
    this.deepseekKey = config.get('DEEPSEEK_API_KEY', { infer: true });
    this.deepseekBase = config.get('DEEPSEEK_BASE_URL', { infer: true });
    this.deepseekModel = config.get('DEEPSEEK_MODEL', { infer: true });
    this.geminiKey = config.get('GEMINI_API_KEY', { infer: true });
    this.geminiBase = config.get('GEMINI_BASE_URL', { infer: true });
    this.geminiModel = config.get('GEMINI_MODEL', { infer: true });
    this.gatewayUrl = (get('ANTIGRAVITY_GATEWAY_URL') ?? '').trim().replace(/\/$/, '');
    this.gatewayKey = (get('ANTIGRAVITY_GATEWAY_KEY') ?? '').trim();
    this.gatewayModel = (get('ANTIGRAVITY_MODEL') ?? '').trim() || DEFAULT_ANTIGRAVITY_MODEL;
    this.gatewayTimeoutMs = positiveInt(get('ANTIGRAVITY_GATEWAY_TIMEOUT_MS'), DEFAULT_ANTIGRAVITY_TIMEOUT_MS);
    this.claudeKey = (get('ANTHROPIC_API_KEY') ?? '').trim();
    this.claudeModel = (get('AI_ADVISOR_CLAUDE_MODEL') ?? '').trim() || DEFAULT_CLAUDE_ADVISOR_MODEL;
    this.order = resolveProviderOrder(get);
    this.configured = new Set(ADVISOR_PROVIDERS.filter((p) => providerConfigured(get, p)));
    this.available = isAdvisorAvailable(get);
    this.globalPerMin = positiveInt(get('AI_ADVISOR_GLOBAL_PER_MIN'), DEFAULT_GLOBAL_PER_MIN);
    this.maxConcurrent = positiveInt(get('AI_ADVISOR_MAX_CONCURRENT'), DEFAULT_MAX_CONCURRENT);
  }

  isConfigured(): boolean {
    return this.available;
  }

  /** Provider này đã đủ khoá để gọi (không xét công tắc AI tư vấn và AI_ADVISOR_PROVIDER, vốn chỉ điều khiển AI tư vấn khách). */
  hasProvider(p: AdvisorProvider): boolean {
    return this.configured.has(p);
  }

  /**
   * Gọi LLM theo thứ tự provider đã cấu hình, lỗi → provider kế. Hết phương án, đang tắt, hoặc chạm trần
   * toàn hệ thống → LlmUnavailableException (service đổi thành câu trả lời offline).
   */
  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.available) throw new LlmUnavailableException('error');
    if (!this.reserve()) {
      this.logger.warn('Chạm trần lượt gọi AI (toàn hệ thống hoặc đồng thời), bỏ qua lượt này.');
      throw new LlmUnavailableException('busy');
    }
    try {
      return await this.completeVia(this.order, messages);
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Gọi lần lượt các provider do người gọi chọn, lỗi → provider kế, cùng cách ghi log với `complete`. KHÔNG tính vào trần lượt gọi
   * của AI tư vấn khách (`reserve`) và không xét công tắc AI tư vấn: người gọi tự lọc bằng `hasProvider` và tự giới hạn đồng thời,
   * để việc admin soạn kịch bản (chậm, 20-50 giây) không chiếm chỗ của khách đang hỏi. Danh sách rỗng hoặc hết phương án → LlmUnavailableException.
   */
  async completeVia(providers: readonly AdvisorProvider[], messages: ChatMessage[], opts: CompleteViaOptions = {}): Promise<string> {
    if (providers.length === 0) throw new LlmUnavailableException('error');
    let reason: LlmFailureReason = 'error';
    for (const provider of providers) {
      try {
        return await this.callProvider(provider, messages, opts);
      } catch (e) {
        reason = e instanceof LlmCallError ? e.reason : 'error';
        this.logger.warn(`${provider} lỗi (${reason}): ${(e as Error).message}`);
      }
    }
    throw new LlmUnavailableException(reason);
  }

  private reserve(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= RATE_WINDOW_MS) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= this.globalPerMin || this.inFlight >= this.maxConcurrent) return false;
    this.windowCount += 1;
    this.inFlight += 1;
    return true;
  }

  private callProvider(provider: AdvisorProvider, messages: ChatMessage[], opts: CompleteViaOptions): Promise<string> {
    if (provider === 'antigravity') return this.callAntigravity(messages, opts);
    if (provider === 'claude') return this.callClaude(messages, opts);
    if (provider === 'deepseek') return this.callDeepSeek(messages, opts);
    return this.callGemini(messages, opts);
  }

  /**
   * Hợp đồng gateway (copy từ ChoDeli antigravity-client.ts): POST {url}/v1/complete, Bearer key,
   * body {task, prompt, images, model}; 200 → {result, model?, usage?}; lỗi → {error, message}.
   * Gateway tự báo 429 circuit_open khi chạm trần giờ/đồng thời của nó. Model bị agy gỡ → thử lại 1 lần không kèm model.
   */
  private async callAntigravity(messages: ChatMessage[], opts: CompleteViaOptions): Promise<string> {
    const prompt = opts.rawGatewayPrompt ? messages.map((m) => m.content).join('\n\n') : buildGatewayPrompt(messages);
    const timeoutMs = Math.min(this.gatewayTimeoutMs, opts.timeoutMs ?? Number.POSITIVE_INFINITY);
    try {
      return await this.postGateway(prompt, this.gatewayModel, timeoutMs);
    } catch (e) {
      if (e instanceof LlmCallError && /invalid model|not recognized as a known model/i.test(e.detail)) {
        this.logger.warn('Gateway không nhận ANTIGRAVITY_MODEL, thử lại không kèm model.');
        return this.postGateway(prompt, null, timeoutMs);
      }
      throw e;
    }
  }

  private async postGateway(prompt: string, model: string | null, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.gatewayUrl}/v1/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.gatewayKey}` },
        body: JSON.stringify({ task: GATEWAY_TASK, prompt, images: [], ...(model ? { model } : {}) }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: unknown; message?: unknown };
      if (!res.ok) {
        const code = typeof body.error === 'string' ? body.error : 'unknown';
        const detail = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
        const reason: LlmFailureReason = code === 'timeout' ? 'timeout' : res.status === 429 ? 'busy' : 'error';
        throw new LlmCallError(`Gateway ${res.status} ${code}`, reason, detail);
      }
      if (typeof body.result !== 'string' || !body.result.trim()) throw new LlmCallError('Gateway trả về rỗng.', 'error');
      return body.result.trim();
    } catch (e) {
      if (e instanceof LlmCallError) throw e;
      if ((e as Error).name === 'AbortError') throw new LlmCallError('Gateway quá thời gian chờ.', 'timeout');
      throw new LlmCallError(`Gateway không kết nối được: ${(e as Error).name}`, 'error');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Messages API: `system` là tham số riêng, `messages` phải bắt đầu bằng lượt user (lịch sử cắt 6 lượt gần nhất có thể mở đầu bằng lượt trợ lý) và
   * các lượt cùng vai liền nhau được gộp. Không gửi temperature/effort: model do admin đổi qua AI_ADVISOR_CLAUDE_MODEL có thể từ chối giá trị khác mặc định.
   * `max_tokens` cắt giữa chừng vẫn là câu trả lời dùng được (như các provider chat khác); `refusal` thì để provider kế đảm nhận.
   */
  private async callClaude(messages: ChatMessage[], opts: CompleteViaOptions): Promise<string> {
    const system = wellFormed(
      messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n'),
    );
    const turns = toAnthropicTurns(messages);
    if (turns.length === 0) throw new LlmCallError('Claude không có lượt user để gửi.', 'error');
    try {
      const { text, stopReason } = await postAnthropicMessage({
        key: this.claudeKey,
        model: this.claudeModel,
        system,
        messages: turns,
        maxTokens: opts.maxTokens ?? DEFAULT_CLAUDE_MAX_TOKENS,
        timeoutMs: opts.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS,
      });
      if (stopReason === 'refusal') throw new LlmCallError('Claude từ chối trả lời.', 'error');
      return text;
    } catch (e) {
      if (e instanceof LlmCallError) throw e;
      if (e instanceof AnthropicCallError) throw new LlmCallError(e.message, e.kind);
      throw e;
    }
  }

  private callDeepSeek(messages: ChatMessage[], opts: CompleteViaOptions): Promise<string> {
    return this.callChat(this.deepseekBase, this.deepseekKey, this.deepseekModel, 'DeepSeek', messages, opts);
  }

  private callGemini(messages: ChatMessage[], opts: CompleteViaOptions): Promise<string> {
    return this.callChat(this.geminiBase, this.geminiKey, this.geminiModel, 'Gemini', messages, opts);
  }

  /**
   * Gọi endpoint OpenAI-compatible (/chat/completions, Bearer auth). Dùng chung cho
   * DeepSeek và Gemini-proxy (gemini-api.thailam.io.vn — proxy OpenAI-compatible, KHÔNG
   * phải native Google generateContent). baseURL đã gồm phần version (vd .../v1).
   */
  private async callChat(
    baseURL: string,
    apiKey: string,
    model: string,
    label: string,
    messages: ChatMessage[],
    opts: CompleteViaOptions,
  ): Promise<string> {
    const { data } = await axios.post(
      `${baseURL.replace(/\/$/, '')}/chat/completions`,
      { model, messages, temperature: 0.7, max_tokens: opts.maxTokens ?? 800 },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: opts.timeoutMs ?? 30000 },
    );
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${label} trả về rỗng.`);
    return String(text).trim();
  }
}

/** Nửa cặp surrogate lẻ (chữ bị cắt giữa emoji) làm Messages API trả 400 "no low surrogate", nên bỏ chúng; emoji nguyên vẹn giữ nguyên. */
function wellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

/** Bỏ lượt rỗng (API đòi content không rỗng) và lượt trợ lý mở đầu (lượt đầu phải là user), gộp các lượt cùng vai liền nhau; tin `system` đã tách riêng nên bỏ qua. */
function toAnthropicTurns(messages: ChatMessage[]): AnthropicTurn[] {
  const turns: AnthropicTurn[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const content = wellFormed(m.content);
    if (content.trim() === '') continue;
    const last = turns[turns.length - 1];
    if (!last && m.role === 'assistant') continue;
    if (last && last.role === m.role) last.content = `${last.content}\n\n${content}`;
    else turns.push({ role: m.role, content });
  }
  return turns;
}
