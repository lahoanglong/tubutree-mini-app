import type { ConfigStore } from './config-store';
import type { CredentialStore } from './credentials';
import type { EchoFilter } from './echo-filter';
import type { Outbox } from './outbox';
import { classifyLoginError } from './login-error';
import { applyQrEvent, idleQr, type QrEventLike, type QrState } from './qr-session';
import { Reconnector } from './reconnect';
import type { SendDedupe } from './send-dedupe';
import type { SendQueue } from './send-queue';
import type { ZaloBridgeEvent, ZaloBridgeHealth, ZaloCredentials } from './types';

// Các kiểu dưới đây là phần nhỏ của zca-js 2.1.2 mà cầu nối dùng; đã đối chiếu với:
//  - dist/models/Message.d.ts:15-50 (TMessage: msgId/cliMsgId/uidFrom/dName là string, ts là string, content là string | attachment),
//    :54-64 (TQuote.globalMsgId/cliMsgId là number), :81-90 (GroupMessage: type, threadId, isSelf)
//  - dist/models/Undo.d.ts:1-7,30-35 (TUndoContent.globalMsgId là number; Undo: threadId, isGroup)
//  - dist/apis/listen.d.ts:22-31 (CloseReason.DuplicateConnection = 3000) và :33-41 (sự kiện closed/disconnected/error/connected/undo)
//  - dist/apis/sendMessage.d.ts:1-3 (SendMessageResult.msgId là number)
//  - dist/models/Enum.d.ts:1-3 (ThreadType.Group = 1)
export interface ZcaMessageLike {
  type: number;
  threadId: string;
  isSelf: boolean;
  data: {
    msgType?: string;
    msgId: string;
    cliMsgId: string;
    uidFrom: string;
    dName: string;
    ts: string;
    content: string | Record<string, unknown>;
    quote?: { globalMsgId: number; cliMsgId: number; msg?: unknown };
  };
}

export interface ZcaUndoLike {
  threadId: string;
  isGroup: boolean;
  data: { content: { globalMsgId: number } };
}

export interface ZcaListenerLike {
  on(event: string, cb: (...args: never[]) => void): unknown;
  start(opts?: { retryOnClose?: boolean }): void;
  stop(): void;
}

export interface ZcaApiLike {
  listener: ZcaListenerLike;
  sendMessage(msg: { msg: string }, threadId: string, type?: number): Promise<{ message: { msgId: number } | null }>;
  getOwnId(): string;
  fetchAccountInfo(): Promise<{ profile: { displayName: string; avatar: string } }>;
  getAllGroups(): Promise<{ gridVerMap: Record<string, string> }>;
  getGroupInfo(ids: string[]): Promise<{ gridInfoMap: Record<string, { name: string; totalMember: number }> }>;
}

export interface ZcaQrEvent extends QrEventLike {
  data?: (QrEventLike['data'] & { cookie?: unknown; imei?: string; userAgent?: string }) | null;
  actions?: { abort: () => unknown } | null;
}

export interface ZaloLike {
  login(credentials: ZaloCredentials): Promise<ZcaApiLike>;
  loginQR(cb: (e: ZcaQrEvent) => void): Promise<ZcaApiLike>;
}

export interface ZaloClientDeps {
  api?: ZcaApiLike;
  zalo: ZaloLike;
  credentials: Pick<CredentialStore, 'load' | 'save' | 'clear'>;
  configStore: Pick<ConfigStore, 'get' | 'set'>;
  outbox: Pick<Outbox, 'push' | 'size'>;
  echo: EchoFilter;
  queue: SendQueue;
  dedupe: SendDedupe;
  now: () => number;
}

export type BridgeErrorCode = 'NOT_CONNECTED' | 'NO_GROUP' | 'SEND_FAILED' | 'QR_FAILED';

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

const GROUP_THREAD = 1;
// DuplicateConnection và KickConnection (node_modules/zca-js/dist/apis/listen.d.ts:23-27): có người khác mở phiên, không giành lại.
const KICKED_CODES = new Set([3000, 3003]);
const LOGIN_TIMEOUT_MS = 60_000;
const QR_FIRST_IMAGE_TIMEOUT_MS = 20_000;
const GROUP_INFO_CHUNK = 50;
const STABLE_MS = 60_000;

type BridgeState = ZaloBridgeHealth['state'];

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} quá ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createZaloClient(deps: ZaloClientDeps) {
  const { zalo, credentials, configStore, outbox, echo, queue, dedupe, now } = deps;

  let api: ZcaApiLike | null = null;
  let generation = 0;
  let state: BridgeState = 'CONNECTING';
  let since = new Date(now()).toISOString();
  let lastError: string | null = null;
  let zaloUid: string | null = null;
  let displayName: string | null = null;
  let avatar: string | null = null;
  let lastPushedKey: string | null = null;
  let qr: QrState = idleQr();
  let qrAbort: (() => unknown) | null = null;
  const inflight = new Map<string, Promise<{ msgId: string }>>();
  const reconnector = new Reconnector(() => void connect(false));
  let stableTimer: NodeJS.Timeout | null = null;
  const clearStable = (): void => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
  };

  // Không log nội dung tin; outbox đã tự ghi đĩa nên lỗi ghi chỉ cần dấu vết, không được làm sập tiến trình.
  const pushEvent = (e: ZaloBridgeEvent): void => {
    outbox.push(e).catch(() => console.error(`[zalo] không ghi được sự kiện ${e.type} vào hộp thư đi`));
  };

  function setState(next: BridgeState, error: string | null = null): void {
    if (state !== next) since = new Date(now()).toISOString();
    state = next;
    lastError = error;
    const key = `${next}|${error ?? ''}`;
    if (key === lastPushedKey) return;
    lastPushedKey = key;
    pushEvent({ type: 'state', state: next, since, lastError, zaloUid, displayName });
  }

  function detach(): void {
    clearStable();
    const old = api;
    api = null;
    if (!old) return;
    try {
      old.listener.stop();
    } catch {
      // listener đã đóng
    }
  }

  function toMessageEvent(m: ZcaMessageLike, groupId: string): Extract<ZaloBridgeEvent, { type: 'message' }> | null {
    const c = m.data.content;
    let text: string | null = null;
    let imageUrl: string | null = null;
    if (typeof c === 'string') text = c;
    // Cùng TAttachmentContent cho ảnh, tệp, thoại, video, link: chỉ msgType chat.photo mới là ảnh, còn lại bỏ (spec 4.3).
    else if (m.data.msgType === 'chat.photo' && typeof c?.href === 'string') {
      imageUrl = c.href;
      const caption = [c.title, c.description].find((x) => typeof x === 'string' && x.trim() !== '');
      text = typeof caption === 'string' ? caption : null;
    } else return null;
    const q = m.data.quote;
    return {
      type: 'message',
      groupId,
      msgId: String(m.data.msgId),
      cliMsgId: String(m.data.cliMsgId),
      uidFrom: String(m.data.uidFrom),
      dName: m.data.dName ?? '',
      isSelf: m.isSelf,
      ts: Number(m.data.ts),
      text,
      imageUrl,
      quote: q ? { globalMsgId: String(q.globalMsgId), cliMsgId: String(q.cliMsgId), text: typeof q.msg === 'string' ? q.msg : null } : null,
    };
  }

  async function attach(next: ZcaApiLike): Promise<void> {
    const gen = ++generation;
    detach();
    api = next;
    zaloUid = next.getOwnId();
    try {
      const { profile } = await next.fetchAccountInfo();
      displayName = profile.displayName || null;
      avatar = profile.avatar || null;
    } catch {
      // thiếu tên hiển thị không chặn việc nghe tin
    }
    if (gen !== generation) return;
    const live = <A extends never[]>(fn: (...a: A) => void) => (...a: A) => {
      if (gen === generation) fn(...a);
    };

    next.listener.on('connected', live(() => {
      // Chỉ coi là ổn định (đặt lại thời gian chờ) khi đã giữ được kết nối một lúc, nếu không socket chập chờn sẽ nối lại mỗi 5 giây mãi.
      clearStable();
      stableTimer = setTimeout(() => {
        stableTimer = null;
        reconnector.reset();
      }, STABLE_MS);
      setState('CONNECTED');
    }));

    next.listener.on('message', live((m: ZcaMessageLike) => {
      const groupId = configStore.get().groupId;
      if (!groupId || m.type !== GROUP_THREAD || m.threadId !== groupId) return;
      const ev = toMessageEvent(m, groupId);
      if (!ev || echo.isEcho({ msgId: ev.msgId, isSelf: ev.isSelf, text: ev.text })) return;
      pushEvent(ev);
    }));

    next.listener.on('undo', live((u: ZcaUndoLike) => {
      const groupId = configStore.get().groupId;
      if (!groupId || !u.isGroup || u.threadId !== groupId) return;
      pushEvent({ type: 'undo', groupId, msgId: String(u.data.content.globalMsgId) });
    }));

    const dropped = live((code?: number) => {
      detach();
      if (code !== undefined && KICKED_CODES.has(code)) {
        reconnector.cancel();
        setState('KICKED', `Tài khoản đang đăng nhập ở nơi khác (mã ${code})`);
        return;
      }
      setState('CONNECTING', `Mất kết nối Zalo (mã ${code})`);
      reconnector.schedule();
    });
    next.listener.on('closed', dropped);
    next.listener.on('disconnected', dropped);
    // zca-js cũng phát error cho một khung không giải mã được trên socket vẫn khoẻ (listen.js:357-360); chỉ ghi nhận,
    // việc nối lại do closed/disconnected quyết định.
    next.listener.on('error', live(() => {
      if (state === 'CONNECTED') setState('CONNECTED', 'Lỗi từ listener Zalo');
    }));

    setState('CONNECTING');
    next.listener.start({ retryOnClose: false });
  }

  async function connect(initial: boolean): Promise<void> {
    const gen = ++generation;
    detach();
    setState('CONNECTING', initial ? null : lastError);
    let creds: ZaloCredentials | null;
    try {
      creds = await credentials.load();
    } catch (e) {
      creds = null;
      lastError = errMsg(e);
    }
    if (gen !== generation) return;
    if (!creds) {
      setState('NEED_QR', lastError);
      return;
    }
    try {
      const next = await withTimeout(zalo.login(creds), LOGIN_TIMEOUT_MS, 'Đăng nhập Zalo');
      if (gen !== generation) return;
      await attach(next);
    } catch (e) {
      if (gen !== generation) return;
      if (classifyLoginError(e) === 'need-qr') {
        setState('NEED_QR', errMsg(e));
      } else {
        setState('CONNECTING', errMsg(e));
        reconnector.schedule();
      }
    }
  }

  async function start(): Promise<void> {
    if (deps.api) {
      await attach(deps.api);
      return;
    }
    await connect(true);
  }

  async function reconnect(): Promise<void> {
    reconnector.reset();
    await connect(false);
  }

  async function logout(): Promise<void> {
    generation++;
    reconnector.reset();
    detach();
    qrAbort?.();
    qrAbort = null;
    qr = idleQr();
    await credentials.clear();
    zaloUid = null;
    displayName = null;
    avatar = null;
    setState('NEED_QR');
  }

  function qrStart(): Promise<{ status: 'WAITING_SCAN'; image: string }> {
    if (qr.status === 'WAITING_SCAN' && qr.image) return Promise.resolve({ status: 'WAITING_SCAN', image: qr.image });
    qrAbort?.();
    qr = idleQr();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new BridgeError('QR_FAILED', 'Không lấy được mã QR')), QR_FIRST_IMAGE_TIMEOUT_MS);
      zalo
        .loginQR((e) => {
          qr = applyQrEvent(qr, e);
          if (e.actions?.abort) qrAbort = e.actions.abort;
          if (e.type === 0 && qr.image) {
            clearTimeout(timer);
            resolve({ status: 'WAITING_SCAN', image: qr.image });
          }
          if (e.type === 1 || e.type === 3) {
            clearTimeout(timer);
            e.actions?.abort();
            reject(new BridgeError('QR_FAILED', 'Mã QR không dùng được'));
          }
          if (e.type === 4 && e.data?.cookie && e.data.imei && e.data.userAgent) {
            void credentials.save({ cookie: e.data.cookie, imei: e.data.imei, userAgent: e.data.userAgent, savedAt: new Date(now()).toISOString() });
          }
        })
        .then(async (next) => {
          qrAbort = null;
          reconnector.reset();
          await attach(next);
        })
        .catch((e) => {
          clearTimeout(timer);
          if (qr.status !== 'EXPIRED' && qr.status !== 'FAILED' && qr.status !== 'SUCCESS') qr = { status: 'FAILED' };
          reject(new BridgeError('QR_FAILED', errMsg(e)));
        });
    });
  }

  async function groups(): Promise<{ id: string; name: string; memberCount: number }[]> {
    if (!api || state !== 'CONNECTED') throw new BridgeError('NOT_CONNECTED');
    const ids = Object.keys((await api.getAllGroups()).gridVerMap ?? {});
    const out: { id: string; name: string; memberCount: number }[] = [];
    for (let i = 0; i < ids.length; i += GROUP_INFO_CHUNK) {
      const info = await api.getGroupInfo(ids.slice(i, i + GROUP_INFO_CHUNK));
      for (const [id, g] of Object.entries(info.gridInfoMap ?? {})) {
        out.push({ id, name: g.name || `Nhóm ${id.slice(-4)}`, memberCount: g.totalMember ?? 0 });
      }
    }
    return out;
  }

  async function sendOnce(idempotencyKey: string, text: string): Promise<{ msgId: string }> {
    if (!api || state !== 'CONNECTED') throw new BridgeError('NOT_CONNECTED');
    const groupId = configStore.get().groupId;
    if (!groupId) throw new BridgeError('NO_GROUP');
    const current = api;
    const msgId = await queue.enqueue(async () => {
      if (api !== current || state !== 'CONNECTED') throw new BridgeError('NOT_CONNECTED');
      // Phải ghi nhận trước khi gọi: Zalo có thể phát lại tin (isSelf) trước khi sendMessage trả về.
      echo.noteSending(text);
      let res: Awaited<ReturnType<ZcaApiLike['sendMessage']>>;
      try {
        res = await current.sendMessage({ msg: text }, groupId, GROUP_THREAD);
      } catch (e) {
        throw new BridgeError('SEND_FAILED', errMsg(e));
      }
      if (!res.message) throw new BridgeError('SEND_FAILED', 'Zalo không trả mã tin');
      const id = String(res.message.msgId);
      // Echo selfListen mang TMessage.msgId (string, Message.d.ts:17) còn đây là SendMessageResult.msgId (number,
      // sendMessage.d.ts:2). Hai giá trị cùng một mã tin nhưng số dài có thể mất chính xác khi qua number, nên
      // khớp theo nội dung (60 giây) là lưới an toàn khi mã không trùng.
      echo.noteSent(id, text);
      return id;
    });
    dedupe.set(idempotencyKey, msgId);
    await dedupe.persist().catch(() => console.error('[zalo] không ghi được sổ chống gửi trùng'));
    return { msgId };
  }

  // Hai lời gọi cùng khoá chạy đồng thời phải dùng chung một lần gửi, nếu không cả hai cùng lọt qua dedupe.get.
  function send(input: { idempotencyKey: string; text: string }): Promise<{ msgId: string }> {
    const done = dedupe.get(input.idempotencyKey);
    if (done !== undefined) return Promise.resolve({ msgId: done });
    const running = inflight.get(input.idempotencyKey);
    if (running) return running;
    const p = sendOnce(input.idempotencyKey, input.text).finally(() => inflight.delete(input.idempotencyKey));
    inflight.set(input.idempotencyKey, p);
    return p;
  }

  return {
    start,
    reconnect,
    logout,
    qrStart,
    qrStatus: (): QrState => ({ ...qr }),
    groups,
    send,
    async setGroup(groupId: string | null): Promise<void> {
      await configStore.set(groupId);
    },
    state(): ZaloBridgeHealth {
      return {
        state,
        zaloUid,
        displayName,
        avatar,
        since,
        lastError,
        queueSize: queue.size(),
        outboxSize: outbox.size(),
        groupId: configStore.get().groupId,
      };
    },
  };
}

export type ZaloClient = ReturnType<typeof createZaloClient>;
