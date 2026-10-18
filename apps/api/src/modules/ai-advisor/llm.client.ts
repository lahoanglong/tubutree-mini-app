import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.validation';
import {
  type AdvisorProvider,
  isAdvisorAvailable,
  positiveInt,
  resolveProviderOrder,
} from './advisor-config';
import { buildGatewayPrompt } from './gateway-prompt';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
// Phải dài hơn timeout nội bộ của agy trong gateway (60s theo ChoDeli) thì mới nhận được JSON {error:"timeout"}
// gọn thay vì bị ngắt socket; nhưng khách đang chờ nên mặc định ngắn hơn, chấp nhận ngắt sớm và hiện câu xin lỗi.
const DEFAULT_ANTIGRAVITY_TIMEOUT_MS = 45_000;
const DEFAULT_GLOBAL_PER_MIN = 40;
// Mỗi lượt agy khởi động một tiến trình (p50 ~13s ở ChoDeli): gọi song song nhiều thì gateway tự từ chối 429.
const DEFAULT_MAX_CONCURRENT = 3;
const RATE_WINDOW_MS = 60_000;

/**
 * Client LLM cho AI tư vấn (§6.14.3). Antigravity gateway (chính, cùng cách ChoDeli dùng) → DeepSeek → Gemini,
 * chỉ thử những provider đã cấu hình; AI_ADVISOR_PROVIDER chọn cứng một provider (xem advisor-config.ts).
 * Gate bằng cấu hình: tắt hoặc chưa có provider nào → isConfigured()=false để service tắt graceful.
 * KHÔNG dùng Claude/Anthropic (yêu cầu nghiệp vụ).
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
  private readonly order: AdvisorProvider[];
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
    this.order = resolveProviderOrder(get);
    this.available = isAdvisorAvailable(get);
    this.globalPerMin = positiveInt(get('AI_ADVISOR_GLOBAL_PER_MIN'), DEFAULT_GLOBAL_PER_MIN);
    this.maxConcurrent = positiveInt(get('AI_ADVISOR_MAX_CONCURRENT'), DEFAULT_MAX_CONCURRENT);
  }

  isConfigured(): boolean {
    return this.available;
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
      let reason: LlmFailureReason = 'error';
      for (const provider of this.order) {
        try {
          return await this.callProvider(provider, messages);
        } catch (e) {
          reason = e instanceof LlmCallError ? e.reason : 'error';
          this.logger.warn(`${provider} lỗi (${reason}): ${(e as Error).message}`);
        }
      }
      throw new LlmUnavailableException(reason);
    } finally {
      this.inFlight -= 1;
    }
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

  private callProvider(provider: AdvisorProvider, messages: ChatMessage[]): Promise<string> {
    if (provider === 'antigravity') return this.callAntigravity(messages);
    if (provider === 'deepseek') return this.callDeepSeek(messages);
    return this.callGemini(messages);
  }

  /**
   * Hợp đồng gateway (copy từ ChoDeli antigravity-client.ts): POST {url}/v1/complete, Bearer key,
   * body {task, prompt, images, model}; 200 → {result, model?, usage?}; lỗi → {error, message}.
   * Gateway tự báo 429 circuit_open khi chạm trần giờ/đồng thời của nó. Model bị agy gỡ → thử lại 1 lần không kèm model.
   */
  private async callAntigravity(messages: ChatMessage[]): Promise<string> {
    const prompt = buildGatewayPrompt(messages);
    try {
      return await this.postGateway(prompt, this.gatewayModel);
    } catch (e) {
      if (e instanceof LlmCallError && /invalid model|not recognized as a known model/i.test(e.detail)) {
        this.logger.warn('Gateway không nhận ANTIGRAVITY_MODEL, thử lại không kèm model.');
        return this.postGateway(prompt, null);
      }
      throw e;
    }
  }

  private async postGateway(prompt: string, model: string | null): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.gatewayTimeoutMs);
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

  private callDeepSeek(messages: ChatMessage[]): Promise<string> {
    return this.callChat(this.deepseekBase, this.deepseekKey, this.deepseekModel, 'DeepSeek', messages);
  }

  private callGemini(messages: ChatMessage[]): Promise<string> {
    return this.callChat(this.geminiBase, this.geminiKey, this.geminiModel, 'Gemini', messages);
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
  ): Promise<string> {
    const { data } = await axios.post(
      `${baseURL.replace(/\/$/, '')}/chat/completions`,
      { model, messages, temperature: 0.7, max_tokens: 800 },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 },
    );
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${label} trả về rỗng.`);
    return String(text).trim();
  }
}
