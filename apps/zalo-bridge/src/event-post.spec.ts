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

  it.each([
    ['unsupported', 'Tin trả lời này không phải chữ hay ảnh (sticker, tệp, thoại...) nên chưa tới khách. Gõ lại bằng chữ.'],
    ['gone', 'Khách của tin được trích đã xoá tài khoản, tin chưa tới khách.'],
    ['empty', 'Tin trả lời chỉ có mã, chưa có nội dung nên chưa tới khách. Gõ thêm nội dung rồi gửi lại.'],
  ])('notStored %s thì báo lên nhóm, khoá unsent-<msgId>, không mở đầu bằng #', async (reason, text) => {
    const p = poster(() => json(200, { ok: true, notStored: reason }));
    expect(await p.post(msg)).toBe('ok');
    expect(p.notify).toHaveBeenCalledWith({ idempotencyKey: 'unsent-M9', text });
    expect(text.startsWith('#')).toBe(false);
  });

  it('notStored lạ thì không báo', async () => {
    const p = poster(() => json(200, { ok: true, notStored: 'whatever' }));
    expect(await p.post(msg)).toBe('ok');
    expect(p.notify).not.toHaveBeenCalled();
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

  it('conflict thì báo lên nhóm với khoá conflict-<msgId>', async () => {
    const p = poster(() => json(200, { ok: true, conflict: { routed: 'K7Q2', typed: 'B2CD' } }));
    expect(await p.post(msg)).toBe('ok');
    expect(p.notify).toHaveBeenCalledWith({
      idempotencyKey: 'conflict-M9',
      text: 'Tin trả lời trích tin của #K7Q2 nhưng ghi mã #B2CD, chưa gửi cho khách nào. Trích đúng tin hoặc chỉ ghi một mã rồi gửi lại.',
    });
  });

  it.each([[503, 'retry'], [500, 'retry'], [502, 'retry'], [401, 'retry'], [404, 'retry'], [403, 'retry'], [400, 'drop'], [413, 'drop']])('HTTP %i thì %s', async (status, want) => {
    expect(await poster(() => json(status)).post(msg)).toBe(want);
  });

  it('401 ghi một dòng nhắc kiểm tra khoá, không lộ khoá', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await poster(() => json(401)).post(msg);
    expect(err).toHaveBeenCalledWith('[bridge] API từ chối khoá (401) — kiểm tra ZALO_BRIDGE_SECRET');
    expect(JSON.stringify(err.mock.calls)).not.toContain('S'.repeat(32));
    err.mockRestore();
  });

  it('lỗi mạng thì retry', async () => {
    expect(await poster(() => Promise.reject(new Error('ECONNREFUSED'))).post(msg)).toBe('retry');
  });

  it('mọi phản hồi không phải 2xx đều huỷ thân để giải phóng kết nối', async () => {
    const cancel = vi.fn(async () => undefined);
    const res = { status: 500, body: { cancel } } as unknown as Response;
    expect(await poster(() => res).post(msg)).toBe('retry');
    expect(cancel).toHaveBeenCalledTimes(1);
    const bad = { status: 400, body: { cancel: vi.fn(async () => { throw new Error('x'); }) } } as unknown as Response;
    expect(await poster(() => bad).post(msg)).toBe('drop');
  });
});
