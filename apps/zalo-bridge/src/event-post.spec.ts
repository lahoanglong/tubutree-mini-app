import { describe, expect, it, vi } from 'vitest';
import { createEventPoster } from './event-post';
import type { ZaloBridgeEvent } from './types';

const msg: ZaloBridgeEvent = {
  type: 'message', groupId: 'G1', msgId: 'M9', cliMsgId: 'C9', uidFrom: 'U', dName: 'n',
  isSelf: false, ts: 1, text: '#K7Q3 ok', imageUrl: null, quote: null,
};

function poster(res: () => Response | Promise<Response>) {
  const fetchFn = vi.fn(async () => res());
  const notify = vi.fn(async () => undefined);
  const post = createEventPoster({ url: 'http://api/events', secret: 'S'.repeat(32), fetchFn: fetchFn as unknown as typeof fetch, notify });
  return { post, fetchFn, notify };
}
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createEventPoster', () => {
  it('gửi JSON kèm Bearer, 2xx thì ok', async () => {
    const p = poster(() => json(200, { ok: true }));
    expect(await p.post(msg)).toBe('ok');
    const [url, init] = p.fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/events');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${'S'.repeat(32)}`);
    expect(JSON.parse(init.body as string)).toEqual(msg);
    expect(p.notify).not.toHaveBeenCalled();
  });

  it('unknownCode thì báo lên nhóm với khoá unknown-<msgId>', async () => {
    const p = poster(() => json(200, { ok: true, unknownCode: 'K7Q3' }));
    expect(await p.post(msg)).toBe('ok');
    expect(p.notify).toHaveBeenCalledWith({ idempotencyKey: 'unknown-M9', text: 'Không tìm thấy mã #K7Q3, tin chưa tới khách.' });
  });

  it('notify treo mãi vẫn trả ok ngay, không chặn hộp thư đi', async () => {
    const p = poster(() => json(200, { unknownCode: 'K7Q3' }));
    p.notify.mockImplementationOnce(() => new Promise(() => undefined));
    expect(await p.post(msg)).toBe('ok');
  });

  it('thân không phải JSON vẫn là ok', async () => {
    expect(await poster(() => new Response('ok', { status: 200 })).post(msg)).toBe('ok');
  });

  it('báo lên nhóm lỗi không làm sự kiện bị gửi lại', async () => {
    const p = poster(() => json(200, { unknownCode: 'K7Q3' }));
    p.notify.mockRejectedValueOnce(new Error('NOT_CONNECTED'));
    expect(await p.post(msg)).toBe('ok');
  });

  it.each([[503, 'retry'], [500, 'retry'], [502, 'retry'], [401, 'drop'], [400, 'drop'], [404, 'drop']])('HTTP %i thì %s', async (status, want) => {
    expect(await poster(() => json(status)).post(msg)).toBe(want);
  });

  it('lỗi mạng thì retry', async () => {
    expect(await poster(() => Promise.reject(new Error('ECONNREFUSED'))).post(msg)).toBe('retry');
  });
});
