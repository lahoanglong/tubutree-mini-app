import { ConfigService } from '@nestjs/config';
import { AnthropicClient } from './anthropic.client';

const KEY = 'test-key-0123456789-secret';

function client(env: Record<string, string> = { ANTHROPIC_API_KEY: KEY }) {
  return new AnthropicClient(new ConfigService(env) as never);
}

const ok = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('AnthropicClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('không có khoá thì isConfigured=false và complete không gọi mạng', async () => {
    global.fetch = jest.fn() as never;
    const c = client({ ANTHROPIC_API_KEY: '   ' });
    expect(c.isConfigured()).toBe(false);
    await expect(c.complete('s', 'u', 100)).rejects.toThrow(/chưa cấu hình/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('gọi đúng địa chỉ, khoá ở header x-api-key, model mặc định claude-sonnet-5-5, trả chữ nối các khối text', async () => {
    const fetchMock = jest.fn(async () => ok({ content: [{ type: 'text', text: '{"a":' }, { type: 'tool_use' }, { type: 'text', text: '1}' }] }));
    global.fetch = fetchMock as never;
    await expect(client().complete('lời hệ thống', 'lời người dùng', 1234)).resolves.toBe('{"a":1}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1234, system: 'lời hệ thống', messages: [{ role: 'user', content: 'lời người dùng' }] });
    expect(init.body as string).not.toContain(KEY);
  });

  it('không gửi temperature/top_p/top_k (Sonnet 5.5 trả 400 với giá trị khác mặc định) và đặt effort thấp', async () => {
    const fetchMock = jest.fn(async () => ok({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }));
    global.fetch = fetchMock as never;
    await client().complete('s', 'u', 10);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body).not.toHaveProperty('thinking');
  });

  it('stop_reason khác end_turn (max_tokens cụt JSON, refusal) là lỗi, dù có chữ', async () => {
    for (const stop of ['max_tokens', 'refusal']) {
      global.fetch = jest.fn(async () => ok({ content: [{ type: 'text', text: '{"steps":[' }], stop_reason: stop })) as never;
      await expect(client().complete('s', 'u', 10)).rejects.toThrow(`Claude dừng sớm: ${stop}`);
    }
  });

  it('bỏ qua khối thinking, chỉ lấy khối text; hạn chờ theo tham số truyền vào', async () => {
    global.fetch = jest.fn(async () => ok({ content: [{ type: 'thinking', thinking: 'nghĩ' }, { type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn' })) as never;
    await expect(client().complete('s', 'u', 10)).resolves.toBe('{"a":1}');

    jest.useFakeTimers();
    try {
      let aborted = false;
      global.fetch = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          }),
      ) as never;
      const pending = client().complete('s', 'u', 10, 5_000).catch((e: Error) => e);
      await jest.advanceTimersByTimeAsync(4_999);
      expect(aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      expect(aborted).toBe(true);
      expect(((await pending) as Error).message).toMatch(/quá thời gian/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('CLAUDE_API_MODEL đặt thì dùng model đó', async () => {
    const fetchMock = jest.fn(async () => ok({ content: [{ type: 'text', text: 'x' }] }));
    global.fetch = fetchMock as never;
    await client({ ANTHROPIC_API_KEY: KEY, CLAUDE_API_MODEL: 'claude-opus-5-5' }).complete('s', 'u', 10);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe('claude-opus-5-5');
  });

  it('lỗi HTTP chỉ mang mã và loại lỗi, không mang thông điệp của Anthropic, không mang khoá', async () => {
    global.fetch = jest.fn(async () => ok({ error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401)) as never;
    const err = await client().complete('s', 'u', 10).catch((e: Error) => e);
    expect((err as Error).message).toBe('Claude 401 authentication_error');
    expect((err as Error).message).not.toContain(KEY);
  });

  it('trả rỗng thì lỗi; mạng đứt thì lỗi không kèm khoá; quá giờ thì báo quá giờ', async () => {
    global.fetch = jest.fn(async () => ok({ content: [] })) as never;
    await expect(client().complete('s', 'u', 10)).rejects.toThrow(/rỗng/);

    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error(`connect ECONNREFUSED with ${KEY}`), { name: 'FetchError' });
    }) as never;
    const net = await client().complete('s', 'u', 10).catch((e: Error) => e);
    expect((net as Error).message).toBe('Claude không kết nối được: FetchError');

    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as never;
    await expect(client().complete('s', 'u', 10)).rejects.toThrow(/quá thời gian/);
  });
});

describe('AnthropicClient.completeWithImage', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });
  const image = { mediaType: 'image/jpeg' as const, base64: 'QUJDRA==' };

  it('gửi khối image base64 rồi khối text trong MỘT lượt user, giữ system, khoá chỉ ở header', async () => {
    const fetchMock = jest.fn(async () => ok({ content: [{ type: 'text', text: '{"readable":true}' }], stop_reason: 'end_turn' }));
    global.fetch = fetchMock as never;
    await expect(client().completeWithImage('hệ thống', 'đọc nhãn', image, 600, 30_000)).resolves.toBe('{"readable":true}');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: unknown[]; system: string; max_tokens: number; output_config: unknown };
    expect(body.system).toBe('hệ thống');
    expect(body.max_tokens).toBe(600);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJDRA==' } },
          { type: 'text', text: 'đọc nhãn' },
        ],
      },
    ]);
    expect(init.body as string).not.toContain(KEY);
  });

  it('không có khoá thì không gọi mạng; stop_reason khác end_turn là lỗi', async () => {
    global.fetch = jest.fn() as never;
    await expect(client({ ANTHROPIC_API_KEY: '' }).completeWithImage('s', 'u', image, 10)).rejects.toThrow(/chưa cấu hình/);
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = jest.fn(async () => ok({ content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' })) as never;
    await expect(client().completeWithImage('s', 'u', image, 10)).rejects.toThrow('Claude dừng sớm: max_tokens');
  });
});
