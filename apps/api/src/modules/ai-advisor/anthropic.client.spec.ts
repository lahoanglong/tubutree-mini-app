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
