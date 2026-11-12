import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { postAnthropicMessage } from './anthropic.client';
import { COPY_AI_BUDGET_MS, COPY_AI_CALL_CAP_MS, COPY_AI_MAX_CONCURRENT, COPY_AI_MIN_SLICE_MS, COPY_AI_MSG, COPY_AI_PARALLEL, CopyAiService } from './copy-ai.service';
import { COPY_AI_MAX_TOKENS, COPY_REASON, type CopyDraftInput, type CopyDraftOutcome } from './copy-draft';

jest.mock('./anthropic.client', () => {
  const actual = jest.requireActual<typeof import('./anthropic.client')>('./anthropic.client');
  return { ...actual, postAnthropicMessage: jest.fn(actual.postAnthropicMessage) };
});

const KEY = 'sk-ant-test-0123456789-secret';
const post = postAnthropicMessage as jest.Mock;
const fetchMock = jest.fn();

function makeConfig(over: Record<string, string> = {}) {
  const base: Record<string, string> = { ANTHROPIC_API_KEY: KEY, AI_ADVISOR_CLAUDE_MODEL: '', ...over };
  return { get: (k: string) => base[k] } as unknown as ConfigService<Env, true>;
}

const GOOD = JSON.stringify({
  shortDesc: 'Son dưỡng bơ tươi dạng thỏi.',
  description: 'Son dưỡng bơ tươi Pơ Lang mã A08. Dạng thỏi nhỏ gọn.',
  ingredients: ['Bơ tươi'],
});

const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const reply = (text: string, stop_reason = 'end_turn') => response(200, { content: [{ type: 'text', text }], stop_reason });

const product = (i: number, over: Partial<CopyDraftInput> = {}): CopyDraftInput => ({
  id: `p${i}`,
  slug: 'son-duong-bo-tuoi-po-lang-a08',
  name: `Son dưỡng bơ tươi Pơ Lang A08 số ${i}`,
  brand: 'Pơ Lang',
  categories: ['Chăm sóc cá nhân'],
  variations: ['Thỏi 4g'],
  shortDesc: null,
  description: null,
  ingredients: [],
  ...over,
});

const drafts = (out: CopyDraftOutcome[]) => out.map((o) => ('draft' in o ? o.draft : null));
const sentBody = (call = 0) => JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<string, unknown>;

let nowSpy: jest.SpyInstance | undefined;
beforeEach(() => {
  fetchMock.mockReset();
  post.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = undefined;
  jest.restoreAllMocks();
});

describe('CopyAiService.draftBatch', () => {
  it('chưa có ANTHROPIC_API_KEY: không gọi mạng, mọi sản phẩm dùng chữ dự phòng với lý do "AI chưa cấu hình"', async () => {
    const svc = new CopyAiService(makeConfig({ ANTHROPIC_API_KEY: '  ' }));
    expect(svc.isConfigured()).toBe(false);
    const out = await svc.draftBatch([product(1), product(2, { slug: 'khong-co-slug' })]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ draft: { source: 'fallback', warnings: ['AI chưa cấu hình, dùng chữ dự phòng.'] } });
    expect(out[1]).toMatchObject({ id: 'p2', failed: expect.stringContaining(COPY_REASON.notConfigured) });
  });

  it('AI trả bản dùng được: source ai; gọi Haiku mặc định, khoá chỉ trong header, không gửi effort/temperature', async () => {
    fetchMock.mockResolvedValue(reply(GOOD));
    const out = await new CopyAiService(makeConfig()).draftBatch([product(1)]);
    expect(drafts(out)[0]).toMatchObject({ id: 'p1', source: 'ai', shortDesc: 'Son dưỡng bơ tươi dạng thỏi.', ingredients: ['Bơ tươi'], warnings: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(init.body as string).not.toContain(KEY);
    const body = sentBody();
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(COPY_AI_MAX_TOKENS);
    expect(body).not.toHaveProperty('output_config');
    expect(body).not.toHaveProperty('temperature');
    expect(String(body.system)).toContain('Không bịa thành phần');
    expect(JSON.stringify(body.messages)).toContain('<du_lieu>');
    expect(post.mock.calls[0]![0].lowEffort).toBeUndefined();
  });

  it('đổi model bằng AI_ADVISOR_CLAUDE_MODEL', async () => {
    fetchMock.mockResolvedValue(reply(GOOD));
    await new CopyAiService(makeConfig({ AI_ADVISOR_CLAUDE_MODEL: ' claude-haiku-9 ' })).draftBatch([product(1)]);
    expect(sentBody().model).toBe('claude-haiku-9');
  });

  it('bản AI chứa câu cấm và thành phần tự thêm: bị lọc, ghi warnings', async () => {
    fetchMock.mockResolvedValue(
      reply(JSON.stringify({ shortDesc: 'Dưỡng môi.', description: 'Son dưỡng dạng thỏi. Giúp chữa nứt nẻ môi.', ingredients: ['Bơ tươi', 'Vitamin E'] })),
    );
    const [d] = drafts(await new CopyAiService(makeConfig()).draftBatch([product(1)]));
    expect(d).toMatchObject({ source: 'ai', description: 'Son dưỡng dạng thỏi.', ingredients: ['Bơ tươi'] });
    expect(d!.warnings).toEqual(
      expect.arrayContaining(['Đã bỏ câu trong mô tả: "Giúp chữa nứt nẻ môi."', 'Đã bỏ thành phần "Vitamin E": không có trong dữ liệu sản phẩm (AI tự thêm).']),
    );
  });

  it.each([429, 529])('HTTP %i (AI bận): sản phẩm đó dùng chữ dự phòng, lô vẫn chạy tiếp', async (status) => {
    fetchMock.mockResolvedValueOnce(response(status, { error: { type: 'overloaded_error' } })).mockResolvedValue(reply(GOOD));
    const out = await new CopyAiService(makeConfig()).draftBatch([product(1), product(2)]);
    expect(drafts(out)[0]).toMatchObject({ source: 'fallback', warnings: [`${COPY_REASON.busy}, dùng chữ dự phòng.`] });
    expect(drafts(out)[1]).toMatchObject({ source: 'ai' });
  });

  it('hết giờ một lượt gọi: chữ dự phòng với lý do quá thời gian chờ', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const [d] = drafts(await new CopyAiService(makeConfig()).draftBatch([product(1)]));
    expect(d).toMatchObject({ source: 'fallback', warnings: [`${COPY_REASON.timeout}, dùng chữ dự phòng.`] });
  });

  it('lỗi mạng hay HTTP khác: chữ dự phòng với lý do AI gặp lỗi', async () => {
    fetchMock.mockResolvedValueOnce(response(500, { error: { type: 'api_error' } })).mockRejectedValueOnce(new TypeError('fetch failed'));
    const out = await new CopyAiService(makeConfig()).draftBatch([product(1), product(2)]);
    expect(drafts(out).map((d) => d?.warnings[0])).toEqual([`${COPY_REASON.error}, dùng chữ dự phòng.`, `${COPY_REASON.error}, dùng chữ dự phòng.`]);
  });

  it.each([['JSON hỏng', reply('{"description": "cụt')], ['không có JSON', reply('Xin lỗi, tôi không làm được.')], ['dừng vì max_tokens', reply(GOOD, 'max_tokens')], ['model từ chối', reply(GOOD, 'refusal')]])(
    '%s: chữ dự phòng với lý do AI trả lời không dùng được',
    async (_name, res) => {
      fetchMock.mockResolvedValue(res);
      const [d] = drafts(await new CopyAiService(makeConfig()).draftBatch([product(1)]));
      expect(d).toMatchObject({ source: 'fallback', warnings: [`${COPY_REASON.unusable}, dùng chữ dự phòng.`] });
    },
  );

  it('AI lỗi mà sản phẩm không có chữ dự phòng: vào failed kèm lý do, các sản phẩm khác vẫn có bản nháp', async () => {
    fetchMock.mockResolvedValueOnce(response(429, {})).mockResolvedValue(reply(GOOD));
    const out = await new CopyAiService(makeConfig()).draftBatch([product(1, { slug: 'khong-co-slug' }), product(2)]);
    expect(out[0]).toEqual({ id: 'p1', failed: 'AI đang bận, và sản phẩm chưa có chữ dự phòng dùng được nên chưa soạn được.' });
    expect(out[1]).toMatchObject({ draft: { id: 'p2', source: 'ai' } });
  });

  it('kết quả đúng thứ tự đầu vào, chạy song song tối đa COPY_AI_PARALLEL sản phẩm', async () => {
    let running = 0;
    let peak = 0;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((res) => {
          running += 1;
          peak = Math.max(peak, running);
          setTimeout(() => {
            running -= 1;
            res(reply(GOOD));
          }, 5);
        }),
    );
    const inputs = Array.from({ length: 8 }, (_, i) => product(i));
    const out = await new CopyAiService(makeConfig()).draftBatch(inputs);
    expect(out.map((o) => o.id)).toEqual(inputs.map((i) => i.id));
    expect(peak).toBe(COPY_AI_PARALLEL);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('mỗi lượt gọi bị chặn ở COPY_AI_CALL_CAP_MS và ngân sách lô nhỏ hơn hạn 60 giây của proxy', async () => {
    fetchMock.mockResolvedValue(reply(GOOD));
    await new CopyAiService(makeConfig()).draftBatch([product(1)]);
    expect(post.mock.calls[0]![0].timeoutMs).toBe(COPY_AI_CALL_CAP_MS);
    expect(COPY_AI_BUDGET_MS).toBeLessThanOrEqual(50_000);
    expect(COPY_AI_CALL_CAP_MS).toBeLessThanOrEqual(20_000);
    expect(COPY_AI_PARALLEL).toBe(3);
  });

  it('hết ngân sách lô: sản phẩm chưa bắt đầu dùng chữ dự phòng với lý do hết giờ, không gọi AI nữa', async () => {
    let now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((res) =>
          setTimeout(() => {
            now += COPY_AI_BUDGET_MS - COPY_AI_MIN_SLICE_MS + 1;
            res(reply(GOOD));
          }, 0),
        ),
    );
    const out = await new CopyAiService(makeConfig()).draftBatch(Array.from({ length: 5 }, (_, i) => product(i)));
    const d = drafts(out);
    expect(d.slice(0, COPY_AI_PARALLEL).map((x) => x?.source)).toEqual(['ai', 'ai', 'ai']);
    expect(d.slice(COPY_AI_PARALLEL).map((x) => x?.source)).toEqual(['fallback', 'fallback']);
    expect(d[3]!.warnings[0]).toBe(`${COPY_REASON.budget}, dùng chữ dự phòng.`);
    expect(d[3]!.warnings[0]).toContain('Hết giờ');
    expect(fetchMock).toHaveBeenCalledTimes(COPY_AI_PARALLEL);
  });

  it('ngân sách còn ít hơn hạn mỗi lượt thì lượt kế chỉ được chờ phần còn lại', async () => {
    let now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let n = 0;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((res) =>
          setTimeout(() => {
            if (n++ === 0) now += 33_000;
            res(reply(GOOD));
          }, 0),
        ),
    );
    await new CopyAiService(makeConfig()).draftBatch(Array.from({ length: 4 }, (_, i) => product(i)));
    expect(post.mock.calls[3]![0].timeoutMs).toBe(COPY_AI_BUDGET_MS - 33_000);
  });

  it('cổng đồng thời: đang có COPY_AI_MAX_CONCURRENT lô chạy thì lô mới nhận 503 "đang soạn", không gọi AI; xong lô cũ thì nhận lại', async () => {
    const release: (() => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((res) => release.push(() => res(reply(GOOD)))));
    const svc = new CopyAiService(makeConfig());
    const running = Array.from({ length: COPY_AI_MAX_CONCURRENT }, () => svc.draftBatch([product(1)]));
    await new Promise((r) => setImmediate(r));
    const calls = fetchMock.mock.calls.length;

    await expect(svc.draftBatch([product(2)])).rejects.toThrow(new ServiceUnavailableException(COPY_AI_MSG.busy));
    expect(fetchMock).toHaveBeenCalledTimes(calls);

    release.forEach((r) => r());
    await Promise.all(running);
    fetchMock.mockResolvedValue(reply(GOOD));
    await expect(svc.draftBatch([product(3)])).resolves.toHaveLength(1);
  });

  it('cổng được nhả cả khi lô lỗi giữa chừng', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const svc = new CopyAiService(makeConfig());
    await svc.draftBatch([product(1)]);
    await expect(svc.draftBatch([product(2)])).resolves.toHaveLength(1);
  });

  it('log chỉ mang loại lỗi: không có khoá, prompt, tên sản phẩm hay lời model', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation());
    fetchMock
      .mockResolvedValueOnce(response(401, { error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }))
      .mockResolvedValueOnce(reply('LỜI-MODEL-BÍ-MẬT không phải JSON'))
      .mockRejectedValueOnce(new TypeError(`fetch failed ${KEY}`));
    await new CopyAiService(makeConfig()).draftBatch([product(1), product(2), product(3)]);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    expect(logged).not.toBe('');
    for (const secret of [KEY, 'LỜI-MODEL-BÍ-MẬT', 'Son dưỡng bơ tươi', 'Không bịa thành phần', 'du_lieu']) expect(logged).not.toContain(secret);
  });
});
