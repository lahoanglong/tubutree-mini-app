import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_TIMEOUT_MS = 50_000;

export interface AnthropicTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Ảnh gửi cho model đọc (Messages API nhận base64 kèm loại ảnh, không nhận data URL). */
export interface AnthropicImageInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

type AnthropicContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: AnthropicImageInput['mediaType']; data: string } };

/** Lượt gửi đi: chữ thuần (mọi chỗ gọi cũ) hoặc danh sách khối khi có ảnh. `AnthropicTurn[]` vẫn gán được. */
export interface AnthropicRequestTurn {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequest {
  key: string;
  model: string;
  /** Rỗng thì bỏ hẳn trường `system` (API không nhận khối system rỗng). */
  system: string;
  messages: AnthropicRequestTurn[];
  maxTokens: number;
  timeoutMs: number;
  /** `output_config.effort: low` chỉ model đời mới nhận (Sonnet 5.5); Haiku 4.5 trả 400, nên chỉ bật khi người gọi chắc chắn. */
  lowEffort?: boolean;
}

export interface AnthropicReply {
  text: string;
  /** `undefined` khi phản hồi không ghi (mock cũ, proxy). */
  stopReason: string | undefined;
}

/** Lỗi gọi Anthropic chỉ mang mã HTTP và loại lỗi (không mang `error.message` của Anthropic, có thể lặp lại khoá hay lời khách); `kind` để người gọi chọn câu xin lỗi. */
export class AnthropicCallError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'busy' | 'error',
  ) {
    super(message);
  }
}

/**
 * Một lượt gọi Messages API, dùng chung cho Story Studio (`AnthropicClient`) và AI tư vấn khách (`LlmClient`, provider `claude`).
 * Khoá chỉ đi vào header; không bao giờ vào thông điệp lỗi hay log. 429 và 529 (quá tải) là `busy`, hết hạn là `timeout`.
 */
export async function postAnthropicMessage(req: AnthropicRequest): Promise<AnthropicReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': req.key, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.lowEffort ? { output_config: { effort: 'low' } } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages,
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      content?: { type?: string; text?: string }[];
      stop_reason?: unknown;
      error?: { type?: unknown };
    };
    if (!res.ok) {
      const type = typeof body.error?.type === 'string' ? body.error.type.slice(0, 60) : 'unknown';
      throw new AnthropicCallError(`Claude ${res.status} ${type}`, res.status === 429 || res.status === 529 ? 'busy' : 'error');
    }
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new AnthropicCallError('Claude trả về rỗng.', 'error');
    return { text, stopReason: typeof body.stop_reason === 'string' ? body.stop_reason : body.stop_reason === undefined ? undefined : 'unknown' };
  } catch (e) {
    if (e instanceof AnthropicCallError) throw e;
    const name = (e as Error).name;
    if (name === 'AbortError') throw new AnthropicCallError('Claude quá thời gian chờ.', 'timeout');
    throw new AnthropicCallError(`Claude không kết nối được: ${name}`, 'error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gọi trực tiếp Claude cho Story Studio của admin (bước giữa antigravity và deepseek/gemini). AI tư vấn khách có đường riêng qua `LlmClient` (provider `claude`, model Haiku).
 * Khoá chỉ nằm ở đây và ở `LlmClient`: không bao giờ ghi vào log, vào thông điệp lỗi, hay trả ra client; lỗi chỉ mang mã HTTP và loại lỗi của Anthropic.
 */
@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);
  private readonly key: string;
  private readonly model: string;

  constructor(config: ConfigService<Env, true>) {
    this.key = (config.get('ANTHROPIC_API_KEY', { infer: true }) ?? '').trim();
    this.model = (config.get('CLAUDE_API_MODEL', { infer: true }) ?? '').trim() || DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return this.key.length > 0;
  }

  /**
   * Sonnet 5.5 từ chối (400) mọi `temperature`, `top_p`, `top_k` khác mặc định nên không gửi các tham số đó. Suy nghĩ thích ứng
   * mặc định bật và tính vào `max_tokens`; `effort: low` giữ phần suy nghĩ ngắn cho việc soạn JSON ngắn này.
   */
  async complete(system: string, user: string, maxTokens: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    if (!this.isConfigured()) throw new Error('Claude chưa cấu hình khoá.');
    try {
      const { text, stopReason } = await postAnthropicMessage({
        key: this.key,
        model: this.model,
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens,
        timeoutMs,
        lowEffort: true,
      });
      // max_tokens: JSON cụt giữa chừng; refusal: model từ chối. Cả hai đều không phải bản nháp dùng được.
      if (stopReason !== undefined && stopReason !== 'end_turn') throw new Error(`Claude dừng sớm: ${stopReason.slice(0, 30)}`);
      return text;
    } catch (e) {
      const err = e as Error;
      if (err.message.startsWith('Claude không kết nối được')) this.logger.warn(err.message);
      throw err;
    }
  }

  /**
   * Như `complete` nhưng lượt user mang thêm một ảnh (ảnh đứng trước chữ, đúng khuyến nghị của Messages API). Dùng để đọc chữ trên bao bì:
   * model mặc định (Sonnet 5.5) đọc được ảnh; model đặt qua CLAUDE_API_MODEL phải hỗ trợ ảnh. Ảnh KHÔNG bao giờ vào log hay thông điệp lỗi.
   */
  async completeWithImage(system: string, user: string, image: AnthropicImageInput, maxTokens: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    if (!this.isConfigured()) throw new Error('Claude chưa cấu hình khoá.');
    try {
      const { text, stopReason } = await postAnthropicMessage({
        key: this.key,
        model: this.model,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
              { type: 'text', text: user },
            ],
          },
        ],
        maxTokens,
        timeoutMs,
        lowEffort: true,
      });
      if (stopReason !== undefined && stopReason !== 'end_turn') throw new Error(`Claude dừng sớm: ${stopReason.slice(0, 30)}`);
      return text;
    } catch (e) {
      const err = e as Error;
      if (err.message.startsWith('Claude không kết nối được')) this.logger.warn(err.message);
      throw err;
    }
  }
}
