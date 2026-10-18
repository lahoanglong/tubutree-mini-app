import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { LlmClient, LlmUnavailableException } from './llm.client';

function makeConfig(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'https://ds',
    DEEPSEEK_MODEL: 'deepseek-chat',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: 'https://gm',
    GEMINI_MODEL: 'gemini-x',
    ANTIGRAVITY_GATEWAY_URL: 'http://gw:8097/',
    ANTIGRAVITY_GATEWAY_KEY: 'gw-key-test',
    ...over,
  };
  return { get: (k: string) => base[k] } as unknown as ConfigService<Env, true>;
}

const MSGS = [
  { role: 'system' as const, content: 'SYS' },
  { role: 'user' as const, content: 'xin chào' },
];

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const rejected = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('đáng lẽ phải lỗi');
    },
    (e: unknown) => e as LlmUnavailableException,
  );

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('LlmClient chọn provider', () => {
  it('chỉ có gateway URL không có KEY → chưa cấu hình', () => {
    expect(new LlmClient(makeConfig({ ANTIGRAVITY_GATEWAY_KEY: '' })).isConfigured()).toBe(false);
  });
  it('đủ URL + KEY, không đặt selector → cấu hình và gọi antigravity trước deepseek', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { result: ' ok ' }));
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' }));
    const ds = jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockResolvedValue('DS');
    expect(c.isConfigured()).toBe(true);
    expect(await c.complete(MSGS)).toBe('ok');
    expect(ds).not.toHaveBeenCalled();
  });
  it('gateway lỗi → rơi sang deepseek khi để tự chọn', async () => {
    fetchMock.mockResolvedValue(jsonRes(500, { error: 'agy_error' }));
    const c = new LlmClient(makeConfig({ DEEPSEEK_API_KEY: 'd' }));
    jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockResolvedValue('DS');
    expect(await c.complete(MSGS)).toBe('DS');
  });
  it('AI_ADVISOR_PROVIDER=deepseek → không gọi gateway dù có URL+KEY', async () => {
    const c = new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' }));
    jest.spyOn(c as never as { callDeepSeek: () => Promise<string> }, 'callDeepSeek').mockResolvedValue('DS');
    expect(await c.complete(MSGS)).toBe('DS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('AI_ADVISOR_PROVIDER=gemini nhưng chưa có key gemini → chưa cấu hình (không rơi sang gateway)', () => {
    expect(new LlmClient(makeConfig({ AI_ADVISOR_PROVIDER: 'gemini' })).isConfigured()).toBe(false);
  });
  it('AI_ADVISOR_ENABLED=false → tắt dù đủ khoá, complete không gọi mạng', async () => {
    const c = new LlmClient(makeConfig({ AI_ADVISOR_ENABLED: 'false' }));
    expect(c.isConfigured()).toBe(false);
    await expect(c.complete(MSGS)).rejects.toBeInstanceOf(LlmUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LlmClient gateway request', () => {
  it('POST {url}/v1/complete, Bearer key, body task=tubutree + prompt + images rỗng + model', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { result: 'Chào bạn', model: 'm' }));
    const c = new LlmClient(makeConfig({ ANTIGRAVITY_MODEL: 'gemini-test' }));
    expect(await c.complete(MSGS)).toBe('Chào bạn');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gw:8097/v1/complete');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer gw-key-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ task: 'tubutree', images: [], model: 'gemini-test' });
    expect(body.prompt).toContain('SYS');
    expect(body.prompt).toContain('xin chào');
  });
  it('không đặt ANTIGRAVITY_MODEL → model mặc định của ChoDeli', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { result: 'a' }));
    await new LlmClient(makeConfig()).complete(MSGS);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gemini-3.8-flash-high');
  });
  it('model bị agy gỡ → thử lại đúng 1 lần không kèm model', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(500, { error: 'agy_error', message: 'invalid model selection' }))
      .mockResolvedValueOnce(jsonRes(200, { result: 'ok' }));
    expect(await new LlmClient(makeConfig()).complete(MSGS)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('model');
  });
});

describe('LlmClient ánh xạ lỗi', () => {
  const reasonOf = async (c: LlmClient) => {
    const e = await rejected(c.complete(MSGS));
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    return (e as LlmUnavailableException).reason;
  };

  it('429 từ gateway → busy', async () => {
    fetchMock.mockResolvedValue(jsonRes(429, { error: 'circuit_open', message: 'hourly cap reached' }));
    expect(await reasonOf(new LlmClient(makeConfig()))).toBe('busy');
  });
  it('{error:"timeout"} từ gateway → timeout', async () => {
    fetchMock.mockResolvedValue(jsonRes(504, { error: 'timeout' }));
    expect(await reasonOf(new LlmClient(makeConfig()))).toBe('timeout');
  });
  it('result rỗng → error', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { result: '  ' }));
    expect(await reasonOf(new LlmClient(makeConfig()))).toBe('error');
  });
  it('mạng đứt → error, không lộ key/URL trong exception', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed http://gw:8097 gw-key-test'));
    const e = await rejected(new LlmClient(makeConfig()).complete(MSGS));
    expect(e.message).not.toContain('gw-key-test');
    expect(e.message).not.toContain('8097');
  });
  it('quá thời gian chờ → abort và reason timeout', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_u: string, init: { signal: AbortSignal }) =>
          new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))),
      );
      const p = rejected(new LlmClient(makeConfig({ ANTIGRAVITY_GATEWAY_TIMEOUT_MS: '5000' })).complete(MSGS));
      await jest.advanceTimersByTimeAsync(5001);
      expect((await p).reason).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LlmClient giới hạn toàn hệ thống', () => {
  it('quá AI_ADVISOR_GLOBAL_PER_MIN trong 1 phút → busy, không gọi gateway thêm', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { result: 'ok' }));
    const c = new LlmClient(makeConfig({ AI_ADVISOR_GLOBAL_PER_MIN: '2' }));
    await c.complete(MSGS);
    await c.complete(MSGS);
    const e = await rejected(c.complete(MSGS));
    expect(e.reason).toBe('busy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('quá AI_ADVISOR_MAX_CONCURRENT lượt đồng thời → lượt thừa busy; xong lượt thì giải phóng chỗ', async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((res) => (release = () => res(jsonRes(200, { result: 'a' })))));
    const c = new LlmClient(makeConfig({ AI_ADVISOR_MAX_CONCURRENT: '1' }));
    const first = c.complete(MSGS);
    const second = await rejected(c.complete(MSGS));
    expect(second.reason).toBe('busy');
    release();
    expect(await first).toBe('a');
    fetchMock.mockResolvedValue(jsonRes(200, { result: 'b' }));
    expect(await c.complete(MSGS)).toBe('b');
  });
});
