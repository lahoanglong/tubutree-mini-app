import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EchoFilter } from './echo-filter';
import { SendDedupe } from './send-dedupe';
import { SendQueue } from './send-queue';
import type { ZaloBridgeEvent } from './types';
import { createZaloClient, type ZcaApiLike, type ZaloClientDeps } from './zalo-client';

class ZaloApiError extends Error {}

class FakeListener extends EventEmitter {
  start = vi.fn();
  stop = vi.fn();
}

type FakeApi = ZcaApiLike & { listener: FakeListener; sendMessage: ReturnType<typeof vi.fn> };

function fakeApi(over: Partial<ZcaApiLike> = {}): FakeApi {
  const listener = new FakeListener();
  const api = {
    listener,
    sendMessage: vi.fn(async () => ({ message: { msgId: 111 }, attachment: [] })),
    getOwnId: () => 'U1',
    fetchAccountInfo: async () => ({ profile: { displayName: 'Tubu CSKH', avatar: 'a.png' } }),
    getAllGroups: async () => ({ gridVerMap: { G1: '1', G2: '1' } }),
    getGroupInfo: async () => ({ gridInfoMap: { G1: { name: 'CSKH', totalMember: 4 }, G2: { name: 'Khác', totalMember: 9 } } }),
    ...over,
  };
  return api as unknown as FakeApi;
}

const CREDS = { cookie: [], imei: 'i', userAgent: 'ua', savedAt: 'x' };

function setup(opts: { groupId?: string | null; creds?: boolean; login?: () => Promise<ZcaApiLike>; api?: ZcaApiLike | null } = {}) {
  const pushed: ZaloBridgeEvent[] = [];
  const outbox = { push: vi.fn(async (e: ZaloBridgeEvent) => void pushed.push(e)), size: () => 0 };
  let groupId = opts.groupId === undefined ? 'G1' : opts.groupId;
  const configStore = {
    get: () => ({ groupId }),
    set: vi.fn(async (g: string | null) => void (groupId = g)),
  };
  const credentials = {
    load: vi.fn(async () => (opts.creds === false ? null : CREDS)),
    save: vi.fn(async (_c?: unknown, _commit?: unknown) => undefined),
    clear: vi.fn(async () => undefined),
  };
  const api = opts.api === null ? undefined : (opts.api ?? fakeApi());
  const login = vi.fn(opts.login ?? (async () => fakeApi()));
  const deps: ZaloClientDeps = {
    api,
    zalo: { login, loginQR: vi.fn() },
    credentials,
    configStore,
    outbox,
    echo: new EchoFilter(() => Date.now()),
    queue: new SendQueue({ spacingMs: 0, jitterMs: 0, now: () => Date.now(), sleep: async () => undefined, random: () => 0 }),
    dedupe: new SendDedupe(),
    now: () => Date.now(),
  };
  const client = createZaloClient(deps);
  const messages = () => pushed.filter((e): e is Extract<ZaloBridgeEvent, { type: 'message' }> => e.type === 'message');
  return { client, api: api as FakeApi, pushed, messages, outbox, configStore, credentials, login, deps };
}

const groupMsg = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  type: 1,
  threadId: 'G1',
  isSelf: false,
  data: { msgId: '900', cliMsgId: '901', uidFrom: 'U9', dName: 'Lan', ts: '1700000000000', content: 'xin chào', quote: undefined, ...data },
  ...over,
});

async function connected(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.client.start();
  s.api.listener.emit('connected');
  expect(s.client.state().state).toBe('CONNECTED');
  return s;
}

describe('zalo-client: nhận tin', () => {
  it('tin nhóm đã chọn thành sự kiện message đúng trường', async () => {
    const s = await connected();
    s.api.listener.emit('message', groupMsg());
    await vi.waitFor(() => expect(s.messages()).toHaveLength(1));
    expect(s.messages()[0]).toEqual({
      type: 'message', groupId: 'G1', msgId: '900', cliMsgId: '901', uidFrom: 'U9', dName: 'Lan',
      isSelf: false, ts: 1700000000000, text: 'xin chào', imageUrl: null, quote: null,
    });
  });

  it('nhóm khác và chat riêng bị bỏ, không log nội dung', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const s = await connected();
    s.api.listener.emit('message', groupMsg({ threadId: 'G2' }));
    s.api.listener.emit('message', groupMsg({ type: 0, threadId: 'U9' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(s.messages()).toHaveLength(0);
    for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain('xin chào');
    logs.forEach((l) => l.mockRestore());
  });

  it('chưa chọn nhóm thì không đẩy tin nào', async () => {
    const s = await connected({ groupId: null });
    s.api.listener.emit('message', groupMsg());
    await new Promise((r) => setTimeout(r, 10));
    expect(s.messages()).toHaveLength(0);
  });

  it('quote.globalMsgId số thành chuỗi', async () => {
    const s = await connected();
    s.api.listener.emit('message', groupMsg({}, { quote: { globalMsgId: 123, cliMsgId: 7 } }));
    await vi.waitFor(() => expect(s.messages()).toHaveLength(1));
    expect(s.messages()[0].quote).toEqual({ globalMsgId: '123', cliMsgId: '7', text: null });
  });

  it('quote.msg chuỗi thành quote.text, không phải chuỗi thì null', async () => {
    const s = await connected();
    s.api.listener.emit('message', groupMsg({}, { quote: { globalMsgId: 1, cliMsgId: 2, msg: '#K7Q2 · Lan\n—\nhi' } }));
    s.api.listener.emit('message', groupMsg({}, { msgId: '901', quote: { globalMsgId: 3, cliMsgId: 4, msg: { a: 1 } } }));
    await vi.waitFor(() => expect(s.messages()).toHaveLength(2));
    expect(s.messages()[0].quote?.text).toBe('#K7Q2 · Lan\n—\nhi');
    expect(s.messages()[1].quote?.text).toBeNull();
  });

  it('chat.photo lấy href làm imageUrl, chú thích làm text, không có thì null', async () => {
    const s = await connected();
    s.api.listener.emit('message', groupMsg({}, { msgType: 'chat.photo', content: { href: 'https://img/x.jpg', title: 'Hàng lỗi' } }));
    s.api.listener.emit('message', groupMsg({}, { msgId: '901', msgType: 'chat.photo', content: { href: 'https://img/y.jpg', title: '', description: ' ' } }));
    await vi.waitFor(() => expect(s.messages()).toHaveLength(2));
    expect(s.messages()[0]).toMatchObject({ imageUrl: 'https://img/x.jpg', text: 'Hàng lỗi' });
    expect(s.messages()[1]).toMatchObject({ imageUrl: 'https://img/y.jpg', text: null });
  });

  it('tệp, link, thoại, video có href nhưng không phải chat.photo thì bỏ', async () => {
    const s = await connected();
    for (const msgType of ['share.file', 'chat.recommended', 'chat.voice', 'chat.video.msg', 'chat.sticker']) {
      s.api.listener.emit('message', groupMsg({}, { msgType, content: { href: 'https://x/f', title: 't' } }));
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(s.messages()).toHaveLength(0);
  });

  it('nội dung không phải chữ cũng không phải ảnh thì bỏ', async () => {
    const s = await connected();
    s.api.listener.emit('message', groupMsg({}, { content: { catId: 5 } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(s.messages()).toHaveLength(0);
  });

  it('undo của nhóm đã chọn thành {type:undo, msgId} theo globalMsgId', async () => {
    const s = await connected();
    s.api.listener.emit('undo', { threadId: 'G1', isGroup: true, isSelf: false, data: { msgId: '5', content: { globalMsgId: 900 } } });
    s.api.listener.emit('undo', { threadId: 'G2', isGroup: true, isSelf: false, data: { msgId: '6', content: { globalMsgId: 901 } } });
    await vi.waitFor(() => expect(s.pushed.some((e) => e.type === 'undo')).toBe(true));
    expect(s.pushed.filter((e) => e.type === 'undo')).toEqual([{ type: 'undo', groupId: 'G1', msgId: '900' }]);
  });

  it('push lỗi (ghi đĩa hỏng) không làm sập tiến trình', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = await connected();
    s.outbox.push.mockRejectedValueOnce(new Error('disk'));
    s.api.listener.emit('message', groupMsg());
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});

describe('zalo-client: echo', () => {
  it('tin isSelf trùng nội dung tin vừa gửi bị lọc, tin isSelf khác nội dung đi tiếp', async () => {
    const s = await connected();
    await s.client.send({ idempotencyKey: 'k1', text: 'Chào bạn' });
    s.api.listener.emit('message', groupMsg({ isSelf: true }, { msgId: '555', content: 'Chào bạn' }));
    s.api.listener.emit('message', groupMsg({ isSelf: true }, { msgId: '556', content: 'Nhân viên gõ tay' }));
    await vi.waitFor(() => expect(s.messages()).toHaveLength(1));
    expect(s.messages()[0]).toMatchObject({ msgId: '556', isSelf: true, text: 'Nhân viên gõ tay' });
  });

  it('echo về trong lúc sendMessage còn chưa trả (noteSending trước khi gửi)', async () => {
    const api = fakeApi();
    const s = await connected({ api });
    api.sendMessage.mockImplementationOnce(async () => {
      api.listener.emit('message', groupMsg({ isSelf: true }, { msgId: '777', content: 'Sớm' }));
      return { message: { msgId: 777 }, attachment: [] };
    });
    await s.client.send({ idempotencyKey: 'k2', text: 'Sớm' });
    await new Promise((r) => setTimeout(r, 10));
    expect(s.messages()).toHaveLength(0);
  });
});

describe('zalo-client: send', () => {
  it('cùng idempotencyKey gọi tuần tự: sendMessage đúng 1 lần, cùng msgId chuỗi', async () => {
    const s = await connected();
    const a = await s.client.send({ idempotencyKey: 'k', text: 'a' });
    const b = await s.client.send({ idempotencyKey: 'k', text: 'a' });
    expect(a).toEqual({ msgId: '111' });
    expect(b).toEqual(a);
    expect(s.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.api.sendMessage).toHaveBeenCalledWith({ msg: 'a' }, 'G1', 1);
  });

  it('cùng idempotencyKey gọi đồng thời vẫn chỉ gửi 1 lần', async () => {
    const s = await connected();
    const [a, b] = await Promise.all([
      s.client.send({ idempotencyKey: 'k', text: 'a' }),
      s.client.send({ idempotencyKey: 'k', text: 'a' }),
    ]);
    expect(a).toEqual(b);
    expect(s.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('gửi lỗi thì không nhớ khoá, gửi lại được', async () => {
    const s = await connected();
    s.api.sendMessage.mockRejectedValueOnce(new Error('zalo down'));
    await expect(s.client.send({ idempotencyKey: 'k', text: 'a' })).rejects.toMatchObject({ code: 'SEND_FAILED' });
    await expect(s.client.send({ idempotencyKey: 'k', text: 'a' })).resolves.toEqual({ msgId: '111' });
  });

  it('tin đã xếp hàng mà phiên bị đăng xuất hay bị đá trước lúc tới lượt thì NOT_CONNECTED, không gửi', async () => {
    const s = await connected();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const first = s.deps.queue.enqueue(() => gate);
    const second = s.client.send({ idempotencyKey: 'late', text: 'b' });
    await s.client.logout();
    release();
    await first;
    await expect(second).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(s.api.sendMessage).not.toHaveBeenCalled();
  });

  it('chưa có nhóm thì NO_GROUP, chưa kết nối thì NOT_CONNECTED', async () => {
    const s = await connected({ groupId: null });
    await expect(s.client.send({ idempotencyKey: 'k', text: 'a' })).rejects.toMatchObject({ code: 'NO_GROUP' });
    const off = setup({ creds: false });
    await off.client.start();
    await expect(off.client.send({ idempotencyKey: 'k', text: 'a' })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
});

describe('zalo-client: trạng thái và kết nối lại', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('đóng mã 3000 thành KICKED và không tự nối lại', async () => {
    const s = await connected();
    s.api.listener.emit('closed', 3000, 'dup');
    expect(s.client.state().state).toBe('KICKED');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.login).not.toHaveBeenCalled();
    expect(s.client.state().state).toBe('KICKED');
  });

  it('đóng mã khác thành CONNECTING, nối lại sau 5s rồi 10s', async () => {
    const s = await connected();
    s.login.mockRejectedValue(new Error('net'));
    s.api.listener.emit('closed', 1006, '');
    expect(s.client.state().state).toBe('CONNECTING');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(s.login).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.login).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(s.login).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.login).toHaveBeenCalledTimes(2);
    expect(s.client.state().state).toBe('CONNECTING');
  });

  it('socket chập chờn (nối được rồi rớt trong vài giây) thì thời gian chờ nối lại tăng dần', async () => {
    const s = await connected();
    let api = s.api;
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const next = fakeApi();
      s.login.mockResolvedValueOnce(next);
      api.listener.emit('closed', 1006, '');
      const before = s.login.mock.calls.length;
      const wait = 5_000 * 2 ** i;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(s.login.mock.calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(s.login.mock.calls.length).toBe(before + 1);
      waits.push(wait);
      next.listener.emit('connected');
      await vi.advanceTimersByTimeAsync(5_000);
      api = next;
    }
    expect(waits).toEqual([5_000, 10_000, 20_000]);
  });

  it('closed rồi disconnected liên tiếp chỉ hẹn một lần', async () => {
    const s = await connected();
    s.login.mockRejectedValue(new Error('net'));
    s.api.listener.emit('disconnected', 1006, '');
    s.api.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  it('error của listener (một khung hỏng) giữ CONNECTED, không dừng listener, không nối lại', async () => {
    const s = await connected();
    s.api.listener.emit('error', new Error('bad frame'));
    expect(s.client.state()).toMatchObject({ state: 'CONNECTED', lastError: 'Lỗi từ listener Zalo' });
    expect(s.api.listener.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.login).not.toHaveBeenCalled();
    expect(s.pushed.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual(['CONNECTING', 'CONNECTED', 'CONNECTED']);
  });

  it('đóng mã 3003 như 3000: KICKED, không nối lại', async () => {
    const s = await connected();
    s.api.listener.emit('closed', 3003, 'kick');
    expect(s.client.state().state).toBe('KICKED');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.login).not.toHaveBeenCalled();
  });

  it('nối lại: Zalo từ chối phiên thì NEED_QR và không tự thử lại', async () => {
    const s = await connected();
    s.login.mockRejectedValue(new ZaloApiError('phiên hết hạn'));
    s.api.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.client.state()).toMatchObject({ state: 'NEED_QR', lastError: 'phiên hết hạn' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  it('khởi động: lỗi mạng thì CONNECTING và thử lại sau 5s', async () => {
    const s = setup({ api: null, login: async () => { throw new TypeError('fetch failed'); } });
    await s.client.start();
    expect(s.client.state().state).toBe('CONNECTING');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.login).toHaveBeenCalledTimes(2);
  });

  it('nối lại thành công thì CONNECTED và lần rớt sau lại đợi 5s', async () => {
    const api2 = fakeApi();
    const s = await connected();
    s.login.mockResolvedValueOnce(api2);
    s.api.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(5_000);
    api2.listener.emit('connected');
    expect(s.client.state().state).toBe('CONNECTED');
    await vi.advanceTimersByTimeAsync(60_000);
    s.login.mockRejectedValue(new Error('net'));
    api2.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.login).toHaveBeenCalledTimes(2);
  });

  it('có phiên nhưng Zalo từ chối lúc khởi động thì NEED_QR', async () => {
    const s = setup({ api: null, login: async () => { throw new ZaloApiError('bad cookie'); } });
    await s.client.start();
    expect(s.client.state()).toMatchObject({ state: 'NEED_QR', lastError: 'bad cookie' });
  });

  it('không có phiên thì NEED_QR', async () => {
    const s = setup({ api: null, creds: false });
    await s.client.start();
    expect(s.client.state().state).toBe('NEED_QR');
  });

  it('mỗi lần đổi trạng thái đẩy một sự kiện state', async () => {
    const s = await connected();
    s.api.listener.emit('closed', 3000, '');
    expect(s.pushed.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual(['CONNECTING', 'CONNECTED', 'KICKED']);
    expect(s.pushed.find((e) => e.type === 'state' && e.state === 'CONNECTED')).toMatchObject({ zaloUid: 'U1', displayName: 'Tubu CSKH', lastError: null });
  });

  it('reconnect() thủ công thoát được KICKED', async () => {
    const api2 = fakeApi();
    const s = await connected();
    s.login.mockResolvedValueOnce(api2);
    s.api.listener.emit('closed', 3000, '');
    await s.client.reconnect();
    api2.listener.emit('connected');
    expect(s.client.state().state).toBe('CONNECTED');
  });

  it('sự kiện của api cũ sau khi đã thay bằng api mới bị bỏ qua', async () => {
    const api2 = fakeApi();
    const s = await connected();
    s.login.mockResolvedValueOnce(api2);
    await s.client.reconnect();
    api2.listener.emit('connected');
    s.api.listener.emit('closed', 3000, '');
    expect(s.client.state().state).toBe('CONNECTED');
  });

  it('logout xoá phiên, dừng nghe, về NEED_QR', async () => {
    const s = await connected();
    await s.client.logout();
    expect(s.credentials.clear).toHaveBeenCalled();
    expect(s.api.listener.stop).toHaveBeenCalled();
    expect(s.client.state().state).toBe('NEED_QR');
    s.api.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.login).not.toHaveBeenCalled();
  });

  it('khi vào CONNECTED thì lastError cũ (lỗi listener) bị xoá', async () => {
    const s = await connected();
    s.api.listener.emit('error', new Error('bad frame'));
    expect(s.client.state().lastError).toBe('Lỗi từ listener Zalo');
    s.api.listener.emit('connected');
    expect(s.client.state()).toMatchObject({ state: 'CONNECTED', lastError: null });
  });

  it('sự kiện state chỉ đẩy khi (state, lastError) đổi: rớt rồi nối lại không sinh bản trùng liên tiếp', async () => {
    const api2 = fakeApi();
    const s = await connected();
    s.login.mockResolvedValueOnce(api2);
    s.api.listener.emit('closed', 1006, '');
    await vi.advanceTimersByTimeAsync(5_000);
    api2.listener.emit('connected');
    const seq = s.pushed.filter((e) => e.type === 'state').map((e) => `${(e as { state: string }).state}|${(e as { lastError: string | null }).lastError ?? ''}`);
    expect(seq.filter((k, i) => i > 0 && k === seq[i - 1])).toEqual([]);
    expect(seq).toEqual(['CONNECTING|', 'CONNECTED|', 'CONNECTING|Mất kết nối Zalo (mã 1006)', 'CONNECTED|']);
  });

  it('nối lại thủ công cũng không đẩy hai sự kiện CONNECTING cùng lastError', async () => {
    const s = await connected();
    s.api.listener.emit('closed', 1006, '');
    s.login.mockResolvedValueOnce(fakeApi());
    await s.client.reconnect();
    const seq = s.pushed.filter((e) => e.type === 'state').map((e) => `${(e as { state: string }).state}|${(e as { lastError: string | null }).lastError ?? ''}`);
    expect(seq.filter((k, i) => i > 0 && k === seq[i - 1])).toEqual([]);
  });

  it.each(['Failed to fetch login info: Service Unavailable', 'Failed to fetch server info: Bad Gateway'])('đăng nhập lỗi HTTP 5xx của Zalo (%s) thì CONNECTING và hẹn thử lại, không NEED_QR', async (message) => {
    const s = setup({ api: null, login: async () => { throw new ZaloApiError(message); } });
    await s.client.start();
    expect(s.client.state().state).toBe('CONNECTING');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.login).toHaveBeenCalledTimes(2);
  });

  it('Đăng nhập thất bại (zca-js không lấy được loginInfo) thì NEED_QR', async () => {
    const s = setup({ api: null, login: async () => { throw new ZaloApiError('Đăng nhập thất bại'); } });
    await s.client.start();
    expect(s.client.state().state).toBe('NEED_QR');
  });

  it('đăng nhập bị từ chối 4xx thì NEED_QR và không thử lại', async () => {
    const s = setup({ api: null, login: async () => { throw new ZaloApiError('Failed to fetch login info: Unauthorized'); } });
    await s.client.start();
    expect(s.client.state().state).toBe('NEED_QR');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.login).toHaveBeenCalledTimes(1);
  });
});

describe('zalo-client: đăng nhập QR', () => {
  it('qrStart trả ảnh khi zca phát mã, quét xong thì lưu phiên và kết nối', async () => {
    const api2 = fakeApi();
    const s = setup({ api: null, creds: false });
    let cb: (e: { type: number; data?: Record<string, unknown> | null; actions?: { abort: () => void } | null }) => void = () => undefined;
    let done: (a: ZcaApiLike) => void = () => undefined;
    s.deps.zalo.loginQR = vi.fn((c) => {
      cb = c as typeof cb;
      return new Promise<ZcaApiLike>((r) => (done = r));
    });
    await s.client.start();
    const p = s.client.qrStart();
    cb({ type: 0, data: { image: 'AAAA' }, actions: { abort: vi.fn() } });
    expect(await p).toEqual({ status: 'WAITING_SCAN', image: 'data:image/png;base64,AAAA' });
    cb({ type: 2, data: { display_name: 'Tubu CSKH' } });
    expect(s.client.qrStatus()).toMatchObject({ status: 'SCANNED', displayName: 'Tubu CSKH' });
    cb({ type: 4, data: { cookie: [{ a: 1 }], imei: 'im', userAgent: 'ua2' } });
    expect(s.credentials.save).not.toHaveBeenCalled();
    done(api2);
    await vi.waitFor(() => expect(s.credentials.save).toHaveBeenCalledWith(expect.objectContaining({ cookie: [{ a: 1 }], imei: 'im', userAgent: 'ua2' }), expect.any(Function)));
    await vi.waitFor(() => expect(api2.listener.start).toHaveBeenCalled());
    api2.listener.emit('connected');
    expect(s.client.state().state).toBe('CONNECTED');
    expect(s.client.qrStatus().status).toBe('SUCCESS');
  });

  it('mã hết hạn thì EXPIRED và huỷ phiên chờ', async () => {
    const s = setup({ api: null, creds: false });
    const abort = vi.fn();
    s.deps.zalo.loginQR = vi.fn((c) => {
      (c as (e: unknown) => void)({ type: 0, data: { image: 'A' }, actions: { abort } });
      (c as (e: unknown) => void)({ type: 1, data: null, actions: { abort } });
      return new Promise<ZcaApiLike>(() => undefined);
    });
    await s.client.qrStart();
    expect(s.client.qrStatus().status).toBe('EXPIRED');
    expect(abort).toHaveBeenCalled();
  });

  type QrCb = (e: { type: number; data?: Record<string, unknown> | null; actions?: { abort: () => void } | null }) => void;
  function qrSetup() {
    const s = setup({ api: null, creds: false });
    const cbs: QrCb[] = [];
    const dones: ((a: ZcaApiLike) => void)[] = [];
    const fails: ((e: Error) => void)[] = [];
    const aborts: ReturnType<typeof vi.fn>[] = [];
    const loginQR = vi.fn((c) => {
      cbs.push(c as QrCb);
      aborts.push(vi.fn());
      return new Promise<ZcaApiLike>((r, j) => {
        dones.push(r);
        fails.push(j);
      });
    });
    s.deps.zalo.loginQR = loginQR;
    return { s, cbs, dones, fails, aborts, loginQR };
  }
  const ok4 = { type: 4, data: { cookie: [{ a: 1 }], imei: 'im', userAgent: 'ua2' } };

  it('lưu phiên lỗi thì vẫn CONNECTED, lastError báo không lưu được và không lộ bí mật', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { s, cbs, dones } = qrSetup();
    s.credentials.save.mockRejectedValueOnce(new Error('ENOSPC'));
    await s.client.start();
    const p = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'AAAA' } });
    await p;
    cbs[0](ok4);
    const api2 = fakeApi();
    dones[0](api2);
    await vi.waitFor(() => expect(api2.listener.start).toHaveBeenCalled());
    api2.listener.emit('connected');
    expect(s.client.state()).toMatchObject({ state: 'CONNECTED', lastError: 'Không lưu được phiên đăng nhập: ENOSPC' });
    expect(JSON.stringify(err.mock.calls)).not.toContain('ua2');
    err.mockRestore();
  });

  it('hai qrStart đồng thời chỉ gọi loginQR một lần và cùng nhận ảnh', async () => {
    const { s, cbs, loginQR } = qrSetup();
    await s.client.start();
    const a = s.client.qrStart();
    const b = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'AAAA' } });
    expect(await a).toEqual({ status: 'WAITING_SCAN', image: 'data:image/png;base64,AAAA' });
    expect(await b).toEqual(await a);
    expect(await s.client.qrStart()).toEqual(await a);
    expect(loginQR).toHaveBeenCalledTimes(1);
  });

  it('logout giữa chừng thì thành công muộn của lượt QR bị bỏ qua: không lưu phiên, không CONNECTED', async () => {
    const { s, cbs, dones } = qrSetup();
    await s.client.start();
    const p = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'AAAA' }, actions: { abort: vi.fn() } });
    await p;
    await s.client.logout();
    cbs[0](ok4);
    const api2 = fakeApi();
    dones[0](api2);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.credentials.save).not.toHaveBeenCalled();
    expect(api2.listener.start).not.toHaveBeenCalled();
    expect(s.client.state().state).toBe('NEED_QR');
    expect(s.client.qrStatus().status).toBe('IDLE');
  });

  it('quá 20 giây chưa có ảnh thì lượt đó bị bỏ, thành công muộn bị bỏ qua và qrStart sau mở lượt mới', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { s, cbs, dones, loginQR } = qrSetup();
      await s.client.start();
      const p = s.client.qrStart();
      const rejected = expect(p).rejects.toMatchObject({ code: 'QR_FAILED' });
      await vi.advanceTimersByTimeAsync(20_000);
      await rejected;
      cbs[0]({ type: 0, data: { image: 'LATE' } });
      cbs[0](ok4);
      dones[0](fakeApi());
      await vi.advanceTimersByTimeAsync(10);
      expect(s.credentials.save).not.toHaveBeenCalled();
      expect(s.client.state().state).toBe('NEED_QR');
      const p2 = s.client.qrStart();
      expect(loginQR).toHaveBeenCalledTimes(2);
      cbs[1]({ type: 0, data: { image: 'NEW' } });
      expect(await p2).toMatchObject({ image: 'data:image/png;base64,NEW' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lượt A bị logout trước khi có ảnh: đồng hồ 20 giây của A không làm hỏng lượt B', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { s, cbs } = qrSetup();
      await s.client.start();
      const a = s.client.qrStart();
      a.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(100);
      await s.client.logout();
      await vi.advanceTimersByTimeAsync(9_900);
      const b = s.client.qrStart();
      await vi.advanceTimersByTimeAsync(10_100);
      cbs[1]({ type: 0, data: { image: 'B' } });
      expect(await b).toMatchObject({ image: 'data:image/png;base64,B' });
      expect(s.client.qrStatus().status).toBe('WAITING_SCAN');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lượt đã bị bỏ trước khi zca phát sự kiện đầu thì sự kiện đó gọi abort của zca', async () => {
    const { s, cbs } = qrSetup();
    await s.client.start();
    s.client.qrStart().catch(() => undefined);
    await s.client.logout();
    const abort = vi.fn();
    cbs[0]({ type: 0, data: { image: 'A' }, actions: { abort } });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(s.client.qrStatus().status).toBe('IDLE');
  });

  it('logout giữa lúc đang lưu phiên sau khi quét: vẫn NEED_QR, phiên bị xoá lại, qrStart không mở loginQR thứ hai', async () => {
    const { s, cbs, dones, loginQR } = qrSetup();
    let fileExists = false;
    s.credentials.save.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      fileExists = true;
    });
    s.credentials.clear.mockImplementation(async () => {
      fileExists = false;
    });
    await s.client.start();
    const p = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'AAAA' } });
    await p;
    cbs[0](ok4);
    const api2 = fakeApi();
    dones[0](api2);
    await new Promise((r) => setTimeout(r, 10));
    await expect(s.client.qrStart()).resolves.toMatchObject({ image: 'data:image/png;base64,AAAA' });
    expect(loginQR).toHaveBeenCalledTimes(1);
    await s.client.logout();
    await new Promise((r) => setTimeout(r, 150));
    expect(s.client.state().state).toBe('NEED_QR');
    expect(fileExists).toBe(false);
    expect(api2.listener.start).not.toHaveBeenCalled();
  });

  it('lưu phiên lỗi: rớt socket thì nối lại bằng phiên trong bộ nhớ, rồi lưu lại và xoá lỗi lưu', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { s, cbs, dones } = qrSetup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      s.credentials.save.mockRejectedValueOnce(new Error('ENOSPC'));
      await s.client.start();
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'AAAA' } });
      await p;
      cbs[0](ok4);
      const api2 = fakeApi();
      dones[0](api2);
      await vi.advanceTimersByTimeAsync(5);
      api2.listener.emit('connected');
      expect(s.client.state().lastError).toContain('ENOSPC');
      const api3 = fakeApi();
      s.login.mockResolvedValueOnce(api3);
      api2.listener.emit('closed', 1006, '');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.login).toHaveBeenCalledWith(expect.objectContaining({ cookie: [{ a: 1 }], imei: 'im', userAgent: 'ua2' }));
      api3.listener.emit('connected');
      await vi.advanceTimersByTimeAsync(5);
      expect(s.client.state()).toMatchObject({ state: 'CONNECTED', lastError: null });
      expect(s.credentials.save).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('thứ tự thật của zca-js: type 4 phát trước, logout lúc đang lưu, loginQR xong sau: tệp phiên vắng và nối lại không lên CONNECTED', async () => {
    const { s, cbs, dones } = qrSetup();
    let fileExists = false;
    s.credentials.save.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      fileExists = true;
    });
    s.credentials.clear.mockImplementation(async () => {
      fileExists = false;
    });
    s.credentials.load.mockImplementation(async () => (fileExists ? CREDS : null));
    await s.client.start();
    const p = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'AAAA' } });
    await p;
    cbs[0](ok4);
    await new Promise((r) => setTimeout(r, 10));
    await s.client.logout();
    dones[0](fakeApi());
    await new Promise((r) => setTimeout(r, 200));
    expect(fileExists).toBe(false);
    await s.client.reconnect();
    expect(s.client.state().state).toBe('NEED_QR');
    expect(s.login).not.toHaveBeenCalled();
  });

  it('lượt bị bỏ trước khi có ảnh thì qrStart đang chờ bị từ chối ngay bằng QR_CANCELLED, không treo', async () => {
    const { s } = qrSetup();
    await s.client.start();
    const p = s.client.qrStart();
    const rejected = expect(p).rejects.toMatchObject({ code: 'QR_CANCELLED' });
    await s.client.logout();
    await rejected;
  });

  it('fetchAccountInfo treo thì sau 15 giây attach vẫn nghe tin, không có tên hiển thị', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const api = fakeApi({ fetchAccountInfo: () => new Promise(() => undefined) });
      const s = setup({ api });
      const started = s.client.start();
      await vi.advanceTimersByTimeAsync(15_000);
      await started;
      expect(api.listener.start).toHaveBeenCalled();
      expect(s.client.state()).toMatchObject({ displayName: null, avatar: null });
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
      vi.useRealTimers();
    }
  });

  it('logout trong lúc fetchAccountInfo thì không để lại tên hiển thị cũ', async () => {
    let release: (v: { profile: { displayName: string; avatar: string } }) => void = () => undefined;
    const api = fakeApi({ fetchAccountInfo: () => new Promise((r) => (release = r)) });
    const s = setup({ api });
    const started = s.client.start();
    await s.client.logout();
    release({ profile: { displayName: 'Cũ', avatar: 'c.png' } });
    await started;
    expect(s.client.state()).toMatchObject({ displayName: null, avatar: null });
  });

  it('lưu lại phiên lần nối lại xong sau khi phiên mới thay thế thì không xoá tệp của phiên mới', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      let n = 0;
      s.credentials.save.mockImplementation(async () => {
        n++;
        if (n === 1) throw new Error('ENOSPC');
        if (n === 2) await new Promise((r) => setTimeout(r, 50));
      });
      await s.client.start();
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'AAAA' } });
      await p;
      cbs[0](ok4);
      const api2 = fakeApi();
      dones[0](api2);
      await vi.advanceTimersByTimeAsync(5);
      api2.listener.emit('connected');
      s.login.mockResolvedValueOnce(fakeApi());
      api2.listener.emit('closed', 1006, '');
      await vi.advanceTimersByTimeAsync(5_000);
      const p2 = s.client.qrStart();
      cbs[1]({ type: 0, data: { image: 'BBBB' } });
      await p2;
      cbs[1]({ type: 4, data: { cookie: [{ b: 2 }], imei: 'im2', userAgent: 'ua3' } });
      dones[1](fakeApi());
      await vi.advanceTimersByTimeAsync(100);
      // lần lưu đầu lỗi thì có một lệnh xoá (F1), nhưng không lệnh xoá nào chạy sau lần lưu phiên mới
      const lastSave = s.credentials.save.mock.invocationCallOrder.at(-1)!;
      expect(s.credentials.save.mock.calls.at(-1)?.[0]).toMatchObject({ imei: 'im2' });
      expect(s.credentials.clear.mock.invocationCallOrder.filter((o) => o > lastSave)).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  // Kho phiên giả có độ trễ điều khiển được; file là thứ nằm trên đĩa, history là mọi lần đĩa đổi (imei hoặc null).
  // honorCommit = false mô phỏng một lần ghi bỏ qua kiểm tra trước rename (kho cũ, hay rename đã lỡ chạy).
  function fakeDisk(s: ReturnType<typeof setup>, init: unknown, delay: (c: { imei?: string }) => number = () => 0, honorCommit = false) {
    const disk = { file: init as { imei?: string } | null, clears: 0, history: [] as (string | null)[] };
    s.credentials.load.mockImplementation(async () => disk.file as never);
    s.credentials.save.mockImplementation(async (raw?: unknown, commit?: unknown) => {
      const c = raw as { imei?: string };
      const ms = delay(c);
      if (ms < 0) return new Promise<undefined>(() => undefined);
      await new Promise((r) => setTimeout(r, ms));
      if (honorCommit && typeof commit === 'function' && !commit()) return undefined;
      disk.file = c;
      disk.history.push(c.imei ?? '?');
      return undefined;
    });
    s.credentials.clear.mockImplementation(async () => {
      disk.clears++;
      disk.file = null;
      disk.history.push(null);
    });
    return disk;
  }
  const apiUid = (uid: string) => fakeApi({ getOwnId: () => uid });

  it('v3: phiên nạp từ đĩa, lượt QR chậm bị bỏ rồi sự kiện muộn: tệp phiên còn nguyên và nối lại vẫn đăng nhập được', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { s, cbs, fails } = qrSetup();
      const disk = fakeDisk(s, { cookie: [], imei: 'disk', userAgent: 'u' });
      await s.client.start();
      expect(s.login).toHaveBeenCalledTimes(1);
      const p = s.client.qrStart();
      p.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(20_200);
      cbs[0]({ type: 0, data: { image: 'LATE' }, actions: { abort: () => fails[0](new Error('ZaloApiLoginQRAborted')) } });
      await vi.advanceTimersByTimeAsync(50);
      expect(disk.clears).toBe(0);
      expect(disk.file).toMatchObject({ imei: 'disk' });
      await s.client.reconnect();
      expect(s.login).toHaveBeenCalledTimes(2);
      expect(s.client.state().state).not.toBe('NEED_QR');
    } finally {
      vi.useRealTimers();
    }
  });

  it('v2: logout lúc lượt A đang lưu chậm, B quét xong trước khi A lưu xong: tệp của B còn và trạng thái CONNECTED là B', async () => {
    const { s, cbs, dones } = qrSetup();
    const disk = fakeDisk(s, null, (c) => (c.imei === 'imA' ? 80 : 0));
    await s.client.start();
    const pa = s.client.qrStart();
    cbs[0]({ type: 0, data: { image: 'A' } });
    await pa;
    cbs[0]({ type: 4, data: { cookie: [{ a: 1 }], imei: 'imA', userAgent: 'ua' } });
    await new Promise((r) => setTimeout(r, 10));
    const lo = s.client.logout();
    const pb = s.client.qrStart();
    cbs[1]({ type: 0, data: { image: 'B' } });
    await pb;
    cbs[1]({ type: 4, data: { cookie: [{ b: 2 }], imei: 'imB', userAgent: 'ua' } });
    const apiB = apiUid('UB');
    dones[1](apiB);
    await vi.waitFor(() => expect(apiB.listener.start).toHaveBeenCalled());
    apiB.listener.emit('connected');
    await lo;
    await new Promise((r) => setTimeout(r, 150));
    expect(s.client.state()).toMatchObject({ state: 'CONNECTED', zaloUid: 'UB' });
    expect(disk.file).toMatchObject({ imei: 'imB' });
  });

  it('N3: lần lưu lại phiên cũ chạy muộn không đè lên tệp của phiên mới', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      let failFirst = true;
      const disk = fakeDisk(s, null, (c) => (c.imei === 'im' ? 200 : 0));
      const baseSave = s.credentials.save.getMockImplementation()!;
      s.credentials.save.mockImplementation(async (c?: unknown) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('ENOSPC');
        }
        await baseSave(c);
      });
      await s.client.start();
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'AAAA' } });
      await p;
      cbs[0](ok4);
      const api2 = fakeApi();
      dones[0](api2);
      await vi.advanceTimersByTimeAsync(5);
      api2.listener.emit('connected');
      s.login.mockResolvedValueOnce(fakeApi());
      api2.listener.emit('closed', 1006, '');
      await vi.advanceTimersByTimeAsync(5_000);
      const p2 = s.client.qrStart();
      cbs[1]({ type: 0, data: { image: 'BBBB' } });
      await p2;
      cbs[1]({ type: 4, data: { cookie: [{ b: 2 }], imei: 'imB', userAgent: 'ua3' } });
      dones[1](fakeApi());
      await vi.advanceTimersByTimeAsync(500);
      expect(disk.file).toMatchObject({ imei: 'imB' });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('N4: fetchAccountInfo quá hạn khi đổi tài khoản thì không giữ tên và ảnh của tài khoản trước', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = await connected();
      expect(s.client.state().displayName).toBe('Tubu CSKH');
      const api2 = fakeApi({ getOwnId: () => 'U2', fetchAccountInfo: () => new Promise(() => undefined) });
      s.login.mockResolvedValueOnce(api2);
      const re = s.client.reconnect();
      await vi.advanceTimersByTimeAsync(15_000);
      await re;
      expect(s.client.state()).toMatchObject({ zaloUid: 'U2', displayName: null, avatar: null });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  // Vòng 4. Bất biến: đĩa chỉ giữ phiên mà cầu nối đang muốn (desired); không bao giờ đăng nhập lại tài khoản đã đăng xuất hay đã bỏ.
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const four = (imei: string) => ({ type: 4, data: { cookie: [{ k: imei }], imei, userAgent: 'ua' } });
  async function scan(cbs: QrCb[], i: number, imei: string, p: Promise<unknown>) {
    cbs[i]({ type: 0, data: { image: imei } });
    await p;
    cbs[i](four(imei));
  }
  async function restartFrom(file: unknown) {
    const r = setup({ api: null });
    fakeDisk(r, file);
    await r.client.start();
    return r;
  }

  it('F1: A đã đăng nhập và lưu chậm, logout, B quét xong rồi lưu B lỗi: đĩa không còn A, khởi động lại phải quét QR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      const disk = fakeDisk(s, null, (c) => (c.imei === 'imA' ? 80 : 0));
      const base = s.credentials.save.getMockImplementation()!;
      s.credentials.save.mockImplementation(async (c?: unknown, commit?: unknown) => {
        if ((c as { imei?: string }).imei === 'imB') throw new Error('ENOSPC');
        return base(c, commit);
      });
      await s.client.start();
      await scan(cbs, 0, 'imA', s.client.qrStart());
      dones[0](apiUid('UA'));
      await wait(10);
      const lo = s.client.logout();
      await scan(cbs, 1, 'imB', s.client.qrStart());
      const apiB = apiUid('UB');
      dones[1](apiB);
      await lo;
      await wait(150);
      apiB.listener.emit('connected');
      expect(s.client.state()).toMatchObject({ state: 'CONNECTED', zaloUid: 'UB', lastError: expect.stringContaining('ENOSPC') });
      expect(disk.file).toBeNull();
      const r = await restartFrom(disk.file);
      expect(r.client.state().state).toBe('NEED_QR');
      expect(r.login).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('F1: lệnh xoá của logout luôn chạy dù B đã thay desired: trong lúc B đang lưu, đĩa không còn A', async () => {
    const { s, cbs, dones } = qrSetup();
    const disk = fakeDisk(s, null, (c) => (c.imei === 'imA' ? 80 : 60));
    await s.client.start();
    await scan(cbs, 0, 'imA', s.client.qrStart());
    dones[0](apiUid('UA'));
    await wait(10);
    const lo = s.client.logout();
    await scan(cbs, 1, 'imB', s.client.qrStart());
    dones[1](apiUid('UB'));
    await lo;
    await wait(200);
    // kho giả bỏ qua kiểm tra trước rename nên A vẫn ghi được; lệnh xoá phải chen vào trước khi B ghi
    expect(disk.history).toEqual(['imA', null, 'imB']);
    expect(disk.file).toMatchObject({ imei: 'imB' });
  });

  it('F3: kho thật kiểm tra token trước rename: lần ghi A đang dở lúc logout không bao giờ vào chỗ', async () => {
    const { s, cbs, dones } = qrSetup();
    const disk = fakeDisk(s, null, (c) => (c.imei === 'imA' ? 80 : 0), true);
    await s.client.start();
    await scan(cbs, 0, 'imA', s.client.qrStart());
    dones[0](apiUid('UA'));
    await wait(10);
    const lo = s.client.logout();
    await scan(cbs, 1, 'imB', s.client.qrStart());
    dones[1](apiUid('UB'));
    await lo;
    await wait(200);
    expect(disk.history).not.toContain('imA');
    expect(disk.file).toMatchObject({ imei: 'imB' });
  });

  it('F1: phiên từ đĩa X, quét QR B thành công nhưng lưu B lỗi: xoá tệp X, khởi động lại không đăng nhập X', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      const disk = fakeDisk(s, { cookie: [], imei: 'imX', userAgent: 'u' });
      const base = s.credentials.save.getMockImplementation()!;
      s.credentials.save.mockImplementation(async (c?: unknown, commit?: unknown) => {
        if ((c as { imei?: string }).imei === 'imB') throw new Error('ENOSPC');
        return base(c, commit);
      });
      await s.client.start();
      await scan(cbs, 0, 'imB', s.client.qrStart());
      dones[0](apiUid('UB'));
      await wait(50);
      expect(disk.file).toBeNull();
      const r = await restartFrom(disk.file);
      expect(r.client.state().state).toBe('NEED_QR');
      expect(r.login).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('F2: nối lại trong lúc B còn đang lưu thì dùng phiên B trong bộ nhớ, không đọc tệp cũ trên đĩa', async () => {
    const { s, cbs, dones } = qrSetup();
    fakeDisk(s, { cookie: [], imei: 'imX', userAgent: 'u' }, (c) => (c.imei === 'imB' ? 100 : 0));
    await s.client.start();
    expect(s.login).toHaveBeenCalledTimes(1);
    await scan(cbs, 0, 'imB', s.client.qrStart());
    dones[0](apiUid('UB'));
    await wait(10);
    await s.client.reconnect();
    expect(s.login).toHaveBeenCalledTimes(2);
    expect(s.login.mock.calls[1]).toEqual([expect.objectContaining({ imei: 'imB' })]);
  });

  it('F3: lần lưu treo không chặn: sau thời hạn chờ vẫn attach và CONNECTED, sau 15 giây lastError báo lưu lỗi, logout vẫn trả về', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      fakeDisk(s, null, () => -1);
      await s.client.start();
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'B' } });
      await p;
      cbs[0](four('imB'));
      const apiB = apiUid('UB');
      dones[0](apiB);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(apiB.listener.start).toHaveBeenCalled();
      apiB.listener.emit('connected');
      expect(s.client.state().state).toBe('CONNECTED');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.client.state()).toMatchObject({ state: 'CONNECTED', lastError: expect.stringContaining('Không lưu được phiên đăng nhập') });
      let done = false;
      void s.client.logout().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('F3: lần ghi A treo rồi vào chỗ muộn sau logout thì đĩa được xoá lại; logout chỉ chờ trong thời hạn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { s, cbs, dones } = qrSetup();
      const disk = fakeDisk(s, null, (c) => (c.imei === 'imA' ? 20_000 : 0));
      await s.client.start();
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'A' } });
      await p;
      cbs[0](four('imA'));
      dones[0](apiUid('UA'));
      await vi.advanceTimersByTimeAsync(6_000);
      let settled = false;
      s.client.logout().then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(9_100);
      expect(settled).toBe(true);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(disk.history).toContain('imA');
      expect(disk.file).toBeNull();
      expect(s.client.state().state).toBe('NEED_QR');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('F4: type 4 rồi loginQR bị từ chối: không lưu, giữ tài khoản đang chạy, QR FAILED, nối lại vẫn là tài khoản cũ', async () => {
    const { s, cbs, fails } = qrSetup();
    const disk = fakeDisk(s, { cookie: [], imei: 'imX', userAgent: 'u' });
    await s.client.start();
    await scan(cbs, 0, 'imB', s.client.qrStart());
    await wait(5);
    fails[0](new ZaloApiError('Failed to fetch login info: Service Unavailable'));
    await wait(10);
    expect(s.client.qrStatus().status).toBe('FAILED');
    expect(s.credentials.save).not.toHaveBeenCalled();
    expect(disk.file).toMatchObject({ imei: 'imX' });
    await s.client.reconnect();
    expect(s.login.mock.calls.map((c) => ((c as unknown[])[0] as { imei: string }).imei)).toEqual(['imX', 'imX']);
  });

  it('F5: hai attach chồng nhau cho tài khoản mới, fetch quá hạn: không ghép uid mới với tên tài khoản cũ', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = await connected();
      expect(s.client.state()).toMatchObject({ zaloUid: 'U1', displayName: 'Tubu CSKH' });
      const cbs: QrCb[] = [];
      const dones: ((a: ZcaApiLike) => void)[] = [];
      s.deps.zalo.loginQR = vi.fn((c) => {
        cbs.push(c as QrCb);
        return new Promise<ZcaApiLike>((r) => dones.push(r));
      });
      const hang = () => fakeApi({ getOwnId: () => 'U2', fetchAccountInfo: () => new Promise(() => undefined) });
      const p = s.client.qrStart();
      cbs[0]({ type: 0, data: { image: 'Q' } });
      await p;
      cbs[0](four('im2'));
      dones[0](hang());
      await vi.advanceTimersByTimeAsync(5);
      expect(s.client.state()).toMatchObject({ zaloUid: 'U2', displayName: null, avatar: null });
      s.login.mockResolvedValueOnce(hang());
      void s.client.reconnect();
      await vi.advanceTimersByTimeAsync(15_300);
      expect(s.client.state()).toMatchObject({ zaloUid: 'U2', displayName: null, avatar: null });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('F6: xoá tệp lúc logout lỗi: logout báo LOGOUT_CLEAR_FAILED kèm mã lỗi, ghi log mã, nối lại không đăng nhập từ đĩa', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = setup({ api: null });
      const disk = fakeDisk(s, { cookie: [], imei: 'imX', userAgent: 'u' });
      await s.client.start();
      expect(s.login).toHaveBeenCalledTimes(1);
      s.credentials.clear.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      await expect(s.client.logout()).rejects.toMatchObject({ code: 'LOGOUT_CLEAR_FAILED', message: 'EACCES' });
      expect(JSON.stringify(err.mock.calls)).toContain('EACCES');
      expect(disk.file).toMatchObject({ imei: 'imX' });
      await s.client.reconnect();
      expect(s.client.state().state).toBe('NEED_QR');
      expect(s.login).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
    }
  });
});

describe('zalo-client: nhóm, cấu hình, sổ gửi', () => {
  it('groups() trả id, tên, số thành viên; chưa kết nối thì NOT_CONNECTED', async () => {
    const s = await connected();
    expect(await s.client.groups()).toEqual([
      { id: 'G1', name: 'CSKH', memberCount: 4 },
      { id: 'G2', name: 'Khác', memberCount: 9 },
    ]);
    const off = setup({ creds: false });
    await off.client.start();
    await expect(off.client.groups()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('setGroup lưu vào configStore và health phản ánh', async () => {
    const s = await connected({ groupId: null });
    await s.client.setGroup('G2');
    expect(s.configStore.set).toHaveBeenCalledWith('G2');
    expect(s.client.state().groupId).toBe('G2');
  });

  it('health có avatar và kích cỡ hàng', async () => {
    const s = await connected();
    expect(s.client.state()).toMatchObject({ avatar: 'a.png', queueSize: 0, outboxSize: 0, zaloUid: 'U1' });
  });
});
