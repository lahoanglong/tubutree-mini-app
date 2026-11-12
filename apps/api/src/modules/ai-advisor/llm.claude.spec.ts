import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.validation';
import { LlmClient, LlmUnavailableException, type ChatMessage } from './llm.client';

jest.mock('axios');

const KEY = 'sk-ant-test-0123456789-secret';

function makeConfig(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'https://ds/v1',
    DEEPSEEK_MODEL: 'deepseek-chat',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: 'https://gm/v1',
    GEMINI_MODEL: 'gemini-x',
    ANTHROPIC_API_KEY: KEY,
    ...over,
  };
  return { get: (k: string) => base[k] } as unknown as ConfigService<Env, true>;
}

const MSGS: ChatMessage[] = [
  { role: 'system', content: 'LỜI HỆ THỐNG' },
  { role: 'user', content: 'câu 1' },
  { role: 'assistant', content: 'đáp 1' },
  { role: 'user', content: 'câu hỏi nay' },
];

const ok = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const reply = (text: string, stop_reason = 'end_turn') => ok({ content: [{ type: 'text', text }], stop_reason });
const fetchMock = jest.fn();
const post = axios.post as jest.Mock;

function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  post.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());

describe('LlmClient — provider claude (AI tư vấn khách)', () => {
  it('chỉ có ANTHROPIC_API_KEY: được cấu hình, hasProvider(claude) đúng, provider khác không', () => {
    const c = new LlmClient(makeConfig());
    expect(c.isConfigured()).toBe(true);
    expect(c.hasProvider('claude')).toBe(true);
    expect(c.hasProvider('gemini')).toBe(false);
    expect(new LlmClient(makeConfig({ ANTHROPIC_API_KEY: '  ' })).isConfigured()).toBe(false);
  });

  it('gọi Messages API với claude-haiku-4-5-20251001, khoá ở header, system tách khỏi messages', async () => {
    fetchMock.mockResolvedValueOnce(reply('  Chào bạn 🌿  '));
    await expect(new LlmClient(makeConfig()).complete(MSGS)).resolves.toBe('Chào bạn 🌿');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect(sentBody()).toEqual({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'LỜI HỆ THỐNG',
      messages: [
        { role: 'user', content: 'câu 1' },
        { role: 'assistant', content: 'đáp 1' },
        { role: 'user', content: 'câu hỏi nay' },
      ],
    });
    expect(init.body as string).not.toContain(KEY);
    expect(post).not.toHaveBeenCalled();
  });

  it('không gửi temperature/effort (đổi AI_ADVISOR_CLAUDE_MODEL sang model đời mới không bị 400)', async () => {
    fetchMock.mockResolvedValueOnce(reply('x'));
    await new LlmClient(makeConfig()).complete(MSGS);
    const body = sentBody();
    for (const k of ['temperature', 'top_p', 'top_k', 'output_config', 'thinking']) expect(body).not.toHaveProperty(k);
  });

  it('AI_ADVISOR_CLAUDE_MODEL đặt thì dùng, để trống thì Haiku; CLAUDE_API_MODEL của Story Studio không ảnh hưởng', async () => {
    fetchMock.mockResolvedValue(reply('x'));
    await new LlmClient(makeConfig({ AI_ADVISOR_CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_API_MODEL: 'claude-opus-5-5' })).complete(MSGS);
    expect(sentBody(0).model).toBe('claude-sonnet-5-5');
    await new LlmClient(makeConfig({ AI_ADVISOR_CLAUDE_MODEL: '  ', CLAUDE_API_MODEL: 'claude-opus-5-5' })).complete(MSGS);
    expect(sentBody(1).model).toBe('claude-haiku-4-5-20251001');
  });

  it('lịch sử bắt đầu bằng lượt trợ lý bị bỏ, các lượt liền nhau cùng vai được gộp (API đòi lượt đầu là user)', async () => {
    fetchMock.mockResolvedValueOnce(reply('x'));
    await new LlmClient(makeConfig()).complete([
      { role: 'system', content: 'S' },
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q' },
    ]);
    expect(sentBody().messages).toEqual([
      { role: 'user', content: 'u1\n\nu2' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q' },
    ]);
  });

  it('lượt rỗng hoặc chỉ khoảng trắng bị bỏ (API trả 400 với content rỗng)', async () => {
    fetchMock.mockResolvedValueOnce(reply('x'));
    await new LlmClient(makeConfig()).complete([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'q' },
    ]);
    expect(sentBody().messages).toEqual([{ role: 'user', content: 'hi\n\nq' }]);
  });

  it('nửa cặp surrogate lẻ (cắt giữa emoji) bị bỏ khỏi system và mọi lượt, emoji nguyên vẹn thì giữ', async () => {
    fetchMock.mockResolvedValueOnce(reply('x'));
    await new LlmClient(makeConfig()).complete([
      { role: 'system', content: 'Mô tả cắt dở 🌿 xong \ud83c' },
      { role: 'user', content: '\udf3f đầu lẻ rồi hỏi 🌿' },
    ]);
    const body = sentBody();
    expect(body.system).toBe('Mô tả cắt dở 🌿 xong ');
    expect(body.messages).toEqual([{ role: 'user', content: ' đầu lẻ rồi hỏi 🌿' }]);
  });

  it('không có tin hệ thống thì bỏ hẳn trường system; nhiều tin hệ thống thì nối lại', async () => {
    fetchMock.mockResolvedValue(reply('x'));
    await new LlmClient(makeConfig()).complete([{ role: 'user', content: 'q' }]);
    expect(sentBody(0)).not.toHaveProperty('system');
    await new LlmClient(makeConfig()).complete([{ role: 'system', content: 'S1' }, { role: 'system', content: 'S2' }, { role: 'user', content: 'q' }]);
    expect(sentBody(1).system).toBe('S1\n\nS2');
  });

  it('maxTokens và timeoutMs của người gọi được dùng', async () => {
    fetchMock.mockResolvedValueOnce(reply('x'));
    await new LlmClient(makeConfig()).completeVia(['claude'], MSGS, { maxTokens: 321, timeoutMs: 9_000 });
    expect(sentBody().max_tokens).toBe(321);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('quá hạn thì huỷ yêu cầu và báo lý do timeout', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_u: unknown, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      );
      const pending = new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'claude' })).complete(MSGS).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(11_999);
      expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal as AbortSignal).aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      const err = await pending;
      expect(err).toBeInstanceOf(LlmUnavailableException);
      expect((err as LlmUnavailableException).reason).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  describe('thứ tự và dự phòng', () => {
    it('có cả Claude và Gemini, không gateway: Claude đi trước, Gemini không bị gọi khi Claude trả lời được', async () => {
      fetchMock.mockResolvedValueOnce(reply('từ Claude'));
      const c = new LlmClient(makeConfig({ GEMINI_API_KEY: 'g' }));
      await expect(c.complete(MSGS)).resolves.toBe('từ Claude');
      expect(post).not.toHaveBeenCalled();
    });

    it('Claude 429 → rơi sang Gemini, khách vẫn nhận câu trả lời', async () => {
      fetchMock.mockResolvedValueOnce(ok({ error: { type: 'rate_limit_error' } }, 429));
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'từ Gemini' } }] } });
      await expect(new LlmClient(makeConfig({ GEMINI_API_KEY: 'g' })).complete(MSGS)).resolves.toBe('từ Gemini');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('Claude lỗi mạng hoặc 529 quá tải → rơi sang DeepSeek', async () => {
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { name: 'FetchError' }));
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'từ DeepSeek' } }] } });
      await expect(new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' })).complete(MSGS)).resolves.toBe('từ DeepSeek');
      fetchMock.mockResolvedValueOnce(ok({ error: { type: 'overloaded_error' } }, 529));
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'từ DeepSeek 2' } }] } });
      await expect(new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' })).complete(MSGS)).resolves.toBe('từ DeepSeek 2');
    });

    it('Claude từ chối (stop_reason refusal) hoặc trả rỗng → rơi sang provider kế', async () => {
      fetchMock.mockResolvedValueOnce(reply('không thể giúp', 'refusal'));
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'tiếp' } }] } });
      await expect(new LlmClient(makeConfig({ GEMINI_API_KEY: 'g' })).complete(MSGS)).resolves.toBe('tiếp');
      fetchMock.mockResolvedValueOnce(ok({ content: [], stop_reason: 'end_turn' }));
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'tiếp 2' } }] } });
      await expect(new LlmClient(makeConfig({ GEMINI_API_KEY: 'g' })).complete(MSGS)).resolves.toBe('tiếp 2');
    });

    it('stop_reason max_tokens vẫn dùng được phần chữ đã có (cùng cách với các provider chat khác)', async () => {
      fetchMock.mockResolvedValueOnce(reply('câu trả lời hơi dài', 'max_tokens'));
      await expect(new LlmClient(makeConfig()).complete(MSGS)).resolves.toBe('câu trả lời hơi dài');
    });

    it('gateway đi trước Claude; gateway lỗi → Claude bắt tiếp', async () => {
      fetchMock.mockResolvedValueOnce(ok({ error: 'circuit_open', message: 'x' }, 429)).mockResolvedValueOnce(reply('Claude đỡ'));
      const c = new LlmClient(makeConfig({ ANTIGRAVITY_GATEWAY_URL: 'http://gw', ANTIGRAVITY_GATEWAY_KEY: 'k' }));
      await expect(c.complete(MSGS)).resolves.toBe('Claude đỡ');
      expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://gw/v1/complete');
      expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://api.anthropic.com/v1/messages');
    });

    it('chọn cứng AI_ADVISOR_PROVIDER=claude: chỉ Claude, lỗi thì không rơi sang Gemini dù có khoá', async () => {
      const c = new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'claude', GEMINI_API_KEY: 'g' }));
      fetchMock.mockResolvedValueOnce(ok({ error: { type: 'api_error' } }, 500));
      const e500 = await c.complete(MSGS).catch((e: unknown) => e);
      expect(e500).toBeInstanceOf(LlmUnavailableException);
      expect((e500 as LlmUnavailableException).reason).toBe('error');
      fetchMock.mockResolvedValueOnce(ok({ error: { type: 'rate_limit_error' } }, 429));
      const e429 = await c.complete(MSGS).catch((e: unknown) => e);
      expect((e429 as LlmUnavailableException).reason).toBe('busy');
      expect(post).not.toHaveBeenCalled();
    });

    it('chọn cứng gemini thì khoá Anthropic có sẵn không bị gọi', async () => {
      post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'Gemini' } }] } });
      await new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' })).complete(MSGS);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('không còn lượt user hợp lệ (chỉ có lượt trợ lý) → lỗi, không gọi mạng', async () => {
      const c = new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'claude' }));
      await expect(c.complete([{ role: 'system', content: 'S' }, { role: 'assistant', content: 'a' }])).rejects.toBeInstanceOf(LlmUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('khoá Anthropic không lọt vào log, vào exception, hay vào thông điệp lỗi dù Anthropic lặp lại khoá', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(ok({ error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401));
    const err = await new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'claude' })).complete(MSGS).catch((e: unknown) => e);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect((err as Error).message).not.toContain(KEY);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('claude');
    expect(logged).toContain('401 authentication_error');
    expect(logged).not.toContain(KEY);
    fetchMock.mockRejectedValueOnce(Object.assign(new Error(`connect failed ${KEY}`), { name: 'FetchError' }));
    await new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'claude' })).complete(MSGS).catch(() => undefined);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain(KEY);
  });

  it('Story Studio: completeVia(deepseek/gemini) không đụng tới Claude kể cả khi có khoá Anthropic', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'JSON' } }] } });
    await new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' })).completeVia(['deepseek'], MSGS, { maxTokens: 100 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
