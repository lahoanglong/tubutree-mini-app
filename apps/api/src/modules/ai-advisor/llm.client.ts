import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.validation';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Client LLM cho AI tư vấn (§6.14.3). DeepSeek (chính, OpenAI-compatible) → Gemini (dự phòng).
 * Gate bằng key: chưa cấu hình key nào → isConfigured()=false để service tắt graceful.
 * KHÔNG dùng Claude/Anthropic (yêu cầu nghiệp vụ: dùng DeepSeek + Gemini).
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

  constructor(config: ConfigService<Env, true>) {
    this.deepseekKey = config.get('DEEPSEEK_API_KEY', { infer: true });
    this.deepseekBase = config.get('DEEPSEEK_BASE_URL', { infer: true });
    this.deepseekModel = config.get('DEEPSEEK_MODEL', { infer: true });
    this.geminiKey = config.get('GEMINI_API_KEY', { infer: true });
    this.geminiBase = config.get('GEMINI_BASE_URL', { infer: true });
    this.geminiModel = config.get('GEMINI_MODEL', { infer: true });
  }

  isConfigured(): boolean {
    return Boolean(this.deepseekKey || this.geminiKey);
  }

  /** Gọi LLM với fallback: DeepSeek trước, lỗi → Gemini. Hết phương án → ServiceUnavailable. */
  async complete(messages: ChatMessage[]): Promise<string> {
    if (this.deepseekKey) {
      try {
        return await this.callDeepSeek(messages);
      } catch (e) {
        this.logger.warn(`DeepSeek lỗi, thử Gemini: ${(e as Error).message}`);
      }
    }
    if (this.geminiKey) {
      try {
        return await this.callGemini(messages);
      } catch (e) {
        this.logger.warn(`Gemini lỗi: ${(e as Error).message}`);
      }
    }
    throw new ServiceUnavailableException('AI tư vấn tạm thời chưa khả dụng.');
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
