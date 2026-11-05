import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../config/env.validation';
import { LlmClient, LlmUnavailableException } from './llm.client';

jest.mock('axios');

function makeConfig(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'https://ds/v1',
    DEEPSEEK_MODEL: 'deepseek-chat',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: 'https://gm/v1',
    GEMINI_MODEL: 'gemini-x',
    ANTIGRAVITY_GATEWAY_URL: 'http://gw:8097',
    ANTIGRAVITY_GATEWAY_KEY: 'gw-key-test',
    ...over,
  };
  return { get: (k: string) => base[k] } as unknown as ConfigService<Env, true>;
}

const MSGS = [
  { role: 'system' as const, content: 'LỜI HỆ THỐNG' },
  { role: 'user' as const, content: 'DỮ LIỆU\nHAI DÒNG' },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fetchMock = jest.fn();
const post = axios.post as jest.Mock;

beforeEach(() => {
  fetchMock.mockReset();
  post.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('LlmClient.completeVia', () => {
  it('không chiếm trần đồng thời và trần mỗi phút của AI tư vấn khách', async () => {
    const c = new LlmClient(makeConfig({ AI_ADVISOR_MAX_CONCURRENT: '1', AI_ADVISOR_GLOBAL_PER_MIN: '1' }));
    fetchMock.mockResolvedValue(ok({ result: 'xong' }));
    const results = await Promise.all([1, 2, 3].map(() => c.completeVia(['antigravity'], MSGS)));
    expect(results).toEqual(['xong', 'xong', 'xong']);
    // Trần của AI tư vấn vẫn còn nguyên cho khách: lượt khách đầu tiên không bị 'busy'.
    await expect(c.complete(MSGS)).resolves.toBe('xong');
  });

  it('danh sách rỗng → LlmUnavailableException, không gọi mạng', async () => {
    await expect(new LlmClient(makeConfig()).completeVia([], MSGS)).rejects.toBeInstanceOf(LlmUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rawGatewayPrompt gửi nguyên văn các tin nhắn nối lại, không bọc khung "câu hỏi của khách"', async () => {
    fetchMock.mockResolvedValue(ok({ result: 'xong' }));
    await new LlmClient(makeConfig()).completeVia(['antigravity'], MSGS, { rawGatewayPrompt: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as { prompt: string };
    expect(body.prompt).toBe('LỜI HỆ THỐNG\n\nDỮ LIỆU\nHAI DÒNG');
  });

  it('không có rawGatewayPrompt thì vẫn qua khung của AI tư vấn (gập một dòng, có phân vai)', async () => {
    fetchMock.mockResolvedValue(ok({ result: 'xong' }));
    await new LlmClient(makeConfig()).completeVia(['antigravity'], MSGS);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as { prompt: string };
    expect(body.prompt).toContain('[KHÁCH]: DỮ LIỆU HAI DÒNG');
  });

  it('timeoutMs ngắn hơn ANTIGRAVITY_GATEWAY_TIMEOUT_MS thì gateway bị ngắt theo timeoutMs; dài hơn thì vẫn theo cấu hình gateway', async () => {
    jest.useFakeTimers();
    try {
      const hang = (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      fetchMock.mockImplementation(hang);
      const c = new LlmClient(makeConfig({ ANTIGRAVITY_GATEWAY_TIMEOUT_MS: '45000' }));

      let settled = false;
      const short = c.completeVia(['antigravity'], MSGS, { timeoutMs: 3_000 }).catch((e: unknown) => ((settled = true), e));
      await jest.advanceTimersByTimeAsync(2_999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      expect(await short).toBeInstanceOf(LlmUnavailableException);

      settled = false;
      const long = c.completeVia(['antigravity'], MSGS, { timeoutMs: 120_000 }).catch((e: unknown) => ((settled = true), e));
      await jest.advanceTimersByTimeAsync(44_999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      expect(await long).toBeInstanceOf(LlmUnavailableException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('deepseek nhận max_tokens và timeout do người gọi đặt; mặc định vẫn 800 và 30 giây', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: ' JSON ' } }] } });
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' }));
    await expect(c.completeVia(['deepseek'], MSGS, { maxTokens: 8000, timeoutMs: 21_000 })).resolves.toBe('JSON');
    expect(post.mock.calls[0]![1]).toMatchObject({ max_tokens: 8000 });
    expect(post.mock.calls[0]![2]).toMatchObject({ timeout: 21_000 });

    await c.completeVia(['deepseek'], MSGS);
    expect(post.mock.calls[1]![1]).toMatchObject({ max_tokens: 800 });
    expect(post.mock.calls[1]![2]).toMatchObject({ timeout: 30_000 });
  });

  it('complete() của AI tư vấn khách vẫn bị trần đồng thời chặn như trước', async () => {
    const c = new LlmClient(makeConfig({ AI_ADVISOR_MAX_CONCURRENT: '1' }));
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (release = res)));
    const first = c.complete(MSGS);
    await expect(c.complete(MSGS)).rejects.toMatchObject({ reason: 'busy' });
    release(ok({ result: 'xong' }));
    await expect(first).resolves.toBe('xong');
  });
});
