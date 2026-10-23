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
    save: vi.fn(async () => undefined),
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
    expect(s.messages()[0].quote).toEqual({ globalMsgId: '123', cliMsgId: '7' });
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
    expect(s.credentials.save).toHaveBeenCalledWith(expect.objectContaining({ cookie: [{ a: 1 }], imei: 'im', userAgent: 'ua2' }));
    done(api2);
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
