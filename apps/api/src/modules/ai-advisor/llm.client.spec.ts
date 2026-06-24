import { ServiceUnavailableException } from '@nestjs/common';
import { LlmClient } from './llm.client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

function makeConfig(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'https://ds',
    DEEPSEEK_MODEL: 'deepseek-chat',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: 'https://gm',
    GEMINI_MODEL: 'gemini-2.0-flash',
    ...over,
  };
  return { get: (k: string) => base[k] } as unknown as ConfigService<Env, true>;
}

const MSGS = [{ role: 'user' as const, content: 'hi' }];

describe('LlmClient.isConfigured', () => {
  it('không key nào → false', () => {
    expect(new LlmClient(makeConfig()).isConfigured()).toBe(false);
  });
  it('có deepseek key → true', () => {
    expect(new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'k' })).isConfigured()).toBe(true);
  });
  it('có gemini key → true', () => {
    expect(new LlmClient(makeConfig({ GEMINI_API_KEY: 'k' })).isConfigured()).toBe(true);
  });
});

describe('LlmClient.complete', () => {
  it('không key → ServiceUnavailable', async () => {
    await expect(new LlmClient(makeConfig()).complete(MSGS)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('deepseek ok → trả kết quả deepseek, KHÔNG gọi gemini', async () => {
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'k', GEMINI_API_KEY: 'g' }));
    const ds = jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockResolvedValue('DS');
    const gm = jest.spyOn(c as never as { callGemini: () => Promise<string> }, 'callGemini').mockResolvedValue('GM');
    expect(await c.complete(MSGS)).toBe('DS');
    expect(ds).toHaveBeenCalled();
    expect(gm).not.toHaveBeenCalled();
  });

  it('deepseek lỗi → fallback sang gemini', async () => {
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'k', GEMINI_API_KEY: 'g' }));
    jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockRejectedValue(new Error('boom'));
    jest.spyOn(c as never as { callGemini: () => Promise<string> }, 'callGemini').mockResolvedValue('GM');
    expect(await c.complete(MSGS)).toBe('GM');
  });

  it('chỉ có gemini key → dùng gemini', async () => {
    const c = new LlmClient(makeConfig({ GEMINI_API_KEY: 'g' }));
    const gm = jest.spyOn(c as never as { callGemini: () => Promise<string> }, 'callGemini').mockResolvedValue('GM');
    expect(await c.complete(MSGS)).toBe('GM');
    expect(gm).toHaveBeenCalled();
  });

  it('cả hai lỗi → ServiceUnavailable', async () => {
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'k', GEMINI_API_KEY: 'g' }));
    jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockRejectedValue(new Error('1'));
    jest.spyOn(c as never as { callGemini: () => Promise<string> }, 'callGemini').mockRejectedValue(new Error('2'));
    await expect(c.complete(MSGS)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
