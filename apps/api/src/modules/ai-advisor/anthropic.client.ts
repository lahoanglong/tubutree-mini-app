import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 60_000;

/**
 * Gọi trực tiếp Claude cho Story Studio của admin (bước giữa antigravity và deepseek/gemini). KHÔNG dùng cho AI tư vấn khách.
 * Khoá chỉ nằm ở đây: không bao giờ ghi vào log, vào thông điệp lỗi, hay trả ra client; lỗi chỉ mang mã HTTP và loại lỗi của Anthropic.
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

  async complete(system: string, user: string, maxTokens: number): Promise<string> {
    if (!this.isConfigured()) throw new Error('Claude chưa cấu hình khoá.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          temperature: 0.6,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[]; error?: { type?: unknown } };
      if (!res.ok) {
        const type = typeof body.error?.type === 'string' ? body.error.type.slice(0, 60) : 'unknown';
        throw new Error(`Claude ${res.status} ${type}`);
      }
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) throw new Error('Claude trả về rỗng.');
      return text;
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') throw new Error('Claude quá thời gian chờ.');
      if (err.message.startsWith('Claude ')) throw err;
      this.logger.warn(`Claude không kết nối được: ${err.name}`);
      throw new Error(`Claude không kết nối được: ${err.name}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
