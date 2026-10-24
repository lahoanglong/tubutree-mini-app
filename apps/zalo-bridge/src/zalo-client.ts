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
//  - dist/models/Undo.d.ts:1-7,28-34 (TUndoContent.globalMsgId là number; Undo: threadId, isGroup)
//  - dist/apis/listen.d.ts:22-27 (CloseReason: DuplicateConnection = 3000 ở :25, KickConnection = 3003 ở :26) và :28-45 (ListenerEvents: connected :29, disconnected :30, closed :31, error :32, undo :41)
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

export type BridgeErrorCode = 'NOT_CONNECTED' | 'NO_GROUP' | 'SEND_FAILED' | 'QR_FAILED' | 'QR_CANCELLED' | 'LOGOUT_CLEAR_FAILED';

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

const GROUP_THREAD = 1;
// DuplicateConnection và KickConnection (node_modules/zca-js/dist/apis/listen.d.ts:25-26): có người khác mở phiên, không giành lại.
const KICKED_CODES = new Set([3000, 3003]);
const LOGIN_TIMEOUT_MS = 60_000;
const QR_FIRST_IMAGE_TIMEOUT_MS = 20_000;
const ACCOUNT_INFO_TIMEOUT_MS = 15_000;
const GROUP_INFO_CHUNK = 50;
const STABLE_MS = 60_000;
// Hạn cho MỖI lệnh đĩa (lưu hay xoá tệp phiên): quá hạn thì coi là lỗi để chuỗi lệnh đi tiếp, không treo cả cầu nối.
const PERSIST_TIMEOUT_MS = 15_000;
// Sau khi quét QR xong, attach chờ lần lưu phiên tối đa chừng này rồi chạy tiếp; lỗi lưu đến sau vẫn hiện ở lastError.
const ATTACH_SAVE_WAIT_MS = 5_000;
// logout trả lời trong hạn này dù đĩa chậm; phải dưới hạn 10 giây API đặt cho mỗi lần gọi cầu nối (apps/api bridge-client.ts).
const LOGOUT_DEADLINE_MS = 8_000;

// Phiên đăng nhập QR đã thành công; danh tính của object là token của phiên.
interface Session {
  creds: ZaloCredentials;
}
// Phiên có sẵn trên đĩa lúc khởi động, chưa đọc vào bộ nhớ.
const DISK_SESSION = Symbol('disk-session');
type Desired = Session | typeof DISK_SESSION | null;

interface QrAttempt {
  ended: boolean;
  abandoned: boolean;
  abort: (() => unknown) | null;
  // creds của type 4; chỉ thành phiên (desired, lưu đĩa) khi loginQR đã xong hẳn
  creds: ZaloCredentials | null;
  timer: NodeJS.Timeout | null;
  cancelFirst: ((e: BridgeError) => void) | null;
  first: Promise<{ status: 'WAITING_SCAN'; image: string }>;
}

type BridgeState = ZaloBridgeHealth['state'];

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} quá ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const errCode = (e: unknown): string => (e as NodeJS.ErrnoException | null)?.code ?? errMsg(e);

// Đợi p nhưng không quá ms; không bao giờ reject.
function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

export function createZaloClient(deps: ZaloClientDeps) {
  const { zalo, credentials, configStore, outbox, echo, queue, dedupe, now } = deps;

  let api: ZcaApiLike | null = null;
  let generation = 0;
  let state: BridgeState = 'CONNECTING';
  let since = new Date(now()).toISOString();
  let lastError: string | null = null;
  let zaloUid: string | null = null;
  // Tên và ảnh gắn với uid của tài khoản đã trả chúng; chỉ hiện khi uid đó là uid đang chạy, nên một lần fetch quá hạn
  // (hay attach chồng nhau) không bao giờ ghép uid mới với tên của tài khoản cũ.
  let profile: { uid: string; displayName: string | null; avatar: string | null } | null = null;
  const ownProfile = () => (profile !== null && profile.uid === zaloUid ? profile : null);
  let lastPushedKey: string | null = null;
  let qr: QrState = idleQr();
  let qrAttempt: QrAttempt | null = null;
  let sessionSaveError: string | null = null;
  // Tệp phiên của trạng thái đã đăng xuất có thể còn trên đĩa: chỉ lệnh xoá lúc desired null đặt nó, xoá được hay ghi đè bằng phiên mới thì hết.
  let staleFileError: string | null = null;
  let stateError: string | null = null;
  // `desired` là phiên PHẢI nằm trên đĩa và là phiên duy nhất được dùng để đăng nhập: DISK_SESSION = bản có sẵn lúc khởi động,
  // null = đã đăng xuất (không bao giờ đọc đĩa nữa), Session = phiên QR đã đăng nhập xong (nối lại dùng creds trong bộ nhớ).
  // Đổi desired trước, rồi mới xếp lệnh đĩa. Mọi lệnh đĩa chạy tuần tự trong diskChain, mỗi lệnh có hạn PERSIST_TIMEOUT_MS:
  //  - lưu phiên S chỉ chạy khi S còn là desired lúc bắt đầu và ngay trước rename, nên không ghi phiên đã bỏ hay đã đăng xuất;
  //  - xoá luôn chạy: mọi lần lưu xếp sau nó thuộc phiên mới hơn, nên lệnh xoá không thể xoá mất phiên mới;
  //  - lưu lỗi thì xoá tệp: đĩa trống (khởi động lại thì quét QR) còn hơn giữ tài khoản trước;
  //  - lệnh quá hạn mà sau đó mới chạm đĩa thì xếp thêm một lần ghi lại desired, nên đĩa luôn quay về desired.
  let desired: Desired = DISK_SESSION;
  let diskChain: Promise<void> = Promise.resolve();
  function onDisk(step: () => Promise<void>): Promise<void> {
    const run = diskChain.then(step);
    diskChain = run.catch(() => undefined);
    return run;
  }
  function bounded(op: Promise<void>, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        reject(Object.assign(new Error(`${what} quá ${PERSIST_TIMEOUT_MS / 1000}s`), { code: 'ETIMEDOUT' }));
      }, PERSIST_TIMEOUT_MS);
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        if (late) resync();
        else fn();
      };
      op.then(
        () => settle(resolve),
        (e: unknown) => settle(() => reject(e)),
      );
    });
  }
  const clearFile = () => bounded(credentials.clear(), 'Xoá tệp phiên');
  function setStaleFile(msg: string | null): void {
    if (staleFileError === msg) return;
    staleFileError = msg;
    publishState();
  }
  // Xoá tệp lúc đã đăng xuất (logout và đồng bộ lại): kết quả của chính lệnh này quyết định health có báo tệp cũ còn sót.
  async function clearLoggedOut(): Promise<void> {
    try {
      await clearFile();
    } catch (e) {
      setStaleFile(`Không xoá được tệp phiên đăng nhập cũ (${errCode(e)})`);
      throw e;
    }
    setStaleFile(null);
  }
  // Một lần đồng bộ lại đọc desired lúc nó chạy, nên nhiều lệnh muộn chỉ cần một lần đang chờ; nếu không, đĩa chậm làm chuỗi dài mãi.
  let resyncPending = false;
  function resync(): void {
    if (resyncPending) return;
    resyncPending = true;
    onDisk(() => {
      resyncPending = false;
      const want = desired;
      if (want === null) {
        return clearLoggedOut().catch((e: unknown) => console.error(`[zalo] đồng bộ lại tệp phiên: không xoá được (${errCode(e)})`));
      }
      if (want === DISK_SESSION) return Promise.resolve();
      return writeSession(want);
    }).catch(() => undefined); // writeSession đã tự ghi log và lastError
  }
  function noteSaveError(msg: string | null): void {
    if (sessionSaveError === msg) return;
    sessionSaveError = msg;
    publishState();
  }
  async function writeSession(s: Session): Promise<void> {
    if (desired !== s) return;
    // Lần lưu bị bỏ ở bước kiểm trước rename vẫn trả về bình thường: chỉ rename thật mới ghi đè tệp cũ.
    let committed = false;
    try {
      await bounded(
        credentials.save(s.creds, () => (committed = desired === s)),
        'Lưu phiên',
      );
    } catch (e) {
      console.error(`[zalo] không lưu được phiên đăng nhập (${errCode(e)}), xoá tệp phiên cũ`);
      await clearFile().then(
        () => setStaleFile(null),
        (c: unknown) => console.error(`[zalo] không xoá được tệp phiên (${errCode(c)})`),
      );
      if (desired === s) noteSaveError(`Không lưu được phiên đăng nhập: ${errMsg(e)}`);
      throw e;
    }
    if (committed) setStaleFile(null);
    if (desired === s) noteSaveError(null);
  }
  const persistSession = (s: Session): Promise<void> => onDisk(() => writeSession(s));
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

  /** `error`: lỗi của chính trạng thái này. Lỗi lưu phiên (khi CONNECTED) và lỗi tệp phiên cũ còn sót (mọi trạng thái) ghép thêm khi hiện. */
  function setState(next: BridgeState, error: string | null = null): void {
    if (state !== next) since = new Date(now()).toISOString();
    state = next;
    stateError = error;
    publishState();
  }

  function publishState(): void {
    const base = stateError ?? (state === 'CONNECTED' ? sessionSaveError : null);
    lastError = staleFileError && base !== staleFileError ? (base ? `${base}. ${staleFileError}` : staleFileError) : base;
    const key = `${state}|${lastError ?? ''}`;
    if (key === lastPushedKey) return;
    lastPushedKey = key;
    pushEvent({ type: 'state', state, since, lastError, zaloUid, displayName: ownProfile()?.displayName ?? null });
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
    const uid = next.getOwnId();
    zaloUid = uid;
    let fetched: { displayName: string; avatar: string } | null = null;
    try {
      fetched = (await withTimeout(next.fetchAccountInfo(), ACCOUNT_INFO_TIMEOUT_MS, 'Lấy thông tin tài khoản Zalo')).profile;
    } catch (e) {
      // thiếu tên hiển thị không chặn việc nghe tin, nhưng một lần fetch treo cũng không được giữ chân cả lượt đăng nhập
      console.error(`[zalo] không lấy được thông tin tài khoản: ${errMsg(e)}`);
    }
    if (gen !== generation) return;
    if (fetched) profile = { uid, displayName: fetched.displayName || null, avatar: fetched.avatar || null };
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
    // zca-js cũng phát error cho một khung không giải mã được trên socket vẫn khoẻ (dist/apis/listen.js:358-360 trong bộ xử lý onmessage, và :141-144 cho ws.onerror); chỉ ghi nhận,
    // việc nối lại do closed/disconnected quyết định.
    next.listener.on('error', live(() => {
      console.error('[zalo] listener báo lỗi (socket vẫn mở)');
    }));

    setState('CONNECTING', state === 'CONNECTING' ? stateError : null);
    next.listener.start({ retryOnClose: false });
  }

  async function connect(initial: boolean): Promise<void> {
    const gen = ++generation;
    detach();
    const want = desired;
    // Đã đăng xuất: không đọc đĩa (tệp có thể còn nếu lệnh xoá lỗi), chỉ quét QR mới đăng nhập lại được.
    if (want === null) {
      setState('NEED_QR', stateError);
      return;
    }
    setState('CONNECTING', initial ? null : stateError);
    // Đĩa chỉ được đọc khi desired vẫn là bản có sẵn lúc khởi động; có phiên QR rồi thì dùng creds trong bộ nhớ.
    let creds: ZaloCredentials | null = null;
    let loadError: string | null = null;
    if (want === DISK_SESSION) {
      try {
        creds = await credentials.load();
      } catch (e) {
        loadError = `Không đọc được tệp phiên đăng nhập (${errMsg(e)}): quét QR lại`;
      }
    } else creds = want.creds;
    if (gen !== generation || desired !== want) return;
    if (!creds) {
      setState('NEED_QR', loadError ?? stateError);
      return;
    }
    try {
      const next = await withTimeout(zalo.login(creds), LOGIN_TIMEOUT_MS, 'Đăng nhập Zalo');
      if (gen !== generation || desired !== want) return;
      retrySessionSave();
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

  function retrySessionSave(): void {
    const want = desired;
    if (sessionSaveError === null || want === null || want === DISK_SESSION) return;
    persistSession(want).catch(() => undefined);
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
    abandonQr();
    qr = idleQr();
    sessionSaveError = null;
    desired = null;
    zaloUid = null;
    profile = null;
    // Trạng thái đổi ngay, trước khi đợi đĩa: nếu không, phần đuôi của logout cũ đè lên phiên QR mới đã lên CONNECTED.
    setState('NEED_QR');
    // Bộ nhớ đã an toàn từ đây (desired null, NEED_QR). Quá hạn thì báo lỗi cho admin nhưng lệnh xoá vẫn nằm trong chuỗi và chạy sau.
    const cleared = onDisk(clearLoggedOut);
    let timer: NodeJS.Timeout | undefined;
    let answered = false;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })), LOGOUT_DEADLINE_MS);
    });
    cleared.catch((e: unknown) => {
      if (answered) console.error(`[zalo] đăng xuất: lệnh xoá tệp phiên chạy sau hạn vẫn lỗi (${errCode(e)})`);
    });
    try {
      await Promise.race([cleared, deadline]);
    } catch (e) {
      // desired vẫn là null nên nối lại không đọc tệp còn sót; admin bấm đăng xuất lại để xoá.
      const code = errCode(e);
      console.error(`[zalo] đăng xuất: không xoá được tệp phiên (${code})`);
      throw new BridgeError('LOGOUT_CLEAR_FAILED', code);
    } finally {
      answered = true;
      clearTimeout(timer);
    }
  }

  function abandonQr(): void {
    const a = qrAttempt;
    qrAttempt = null;
    if (!a) return;
    a.abandoned = true;
    a.ended = true;
    if (a.timer) clearTimeout(a.timer);
    a.abort?.();
    a.cancelFirst?.(new BridgeError('QR_CANCELLED', 'Lượt đăng nhập QR đã bị huỷ'));
  }

  // Một lượt QR đang chạy thì mọi lời gọi qrStart dùng chung ảnh đầu của nó. Lượt bị bỏ (quá 20 giây, logout) không được
  // đổi trạng thái hay lưu phiên nữa dù zca-js có phát sự kiện muộn.
  function qrStart(): Promise<{ status: 'WAITING_SCAN'; image: string }> {
    if (qrAttempt && !qrAttempt.ended) return qrAttempt.first;
    abandonQr();
    qr = idleQr();
    const attempt: QrAttempt = { ended: false, abandoned: false, abort: null, creds: null, timer: null, cancelFirst: null, first: null as never };
    qrAttempt = attempt;
    const finish = (): void => {
      attempt.ended = true;
      if (qrAttempt === attempt) qrAttempt = null;
    };
    attempt.first = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (qrAttempt === attempt) qr = { status: 'FAILED' };
        attempt.abandoned = true;
        attempt.ended = true;
        attempt.abort?.();
        if (qrAttempt === attempt) qrAttempt = null;
        reject(new BridgeError('QR_FAILED', 'Không lấy được mã QR'));
      }, QR_FIRST_IMAGE_TIMEOUT_MS);
      attempt.timer = timer;
      attempt.cancelFirst = reject;
      // Lỗi sau type 4 cũng là FAILED (kể cả khi đã hiện SUCCESS): đĩa, desired và phiên đang chạy giữ nguyên.
      const failAttempt = (e: unknown): void => {
        finish();
        if (qr.status !== 'EXPIRED' && qr.status !== 'FAILED') qr = { status: 'FAILED' };
        reject(new BridgeError('QR_FAILED', errMsg(e)));
      };
      zalo
        .loginQR((e) => {
          if (attempt.abandoned) {
            e.actions?.abort?.();
            return;
          }
          qr = applyQrEvent(qr, e);
          if (e.actions?.abort) attempt.abort = e.actions.abort;
          if (e.type === 0 && qr.image) {
            clearTimeout(timer);
            resolve({ status: 'WAITING_SCAN', image: qr.image });
          }
          if (e.type === 1 || e.type === 3) {
            clearTimeout(timer);
            attempt.ended = true;
            e.actions?.abort();
            reject(new BridgeError('QR_FAILED', 'Mã QR không dùng được'));
          }
          // zca-js phát type 4 rồi mới chạy loginCookie, nên loginQR còn có thể lỗi: ở đây chỉ giữ creds trên lượt.
          if (e.type === 4 && e.data?.cookie && e.data.imei && e.data.userAgent) {
            attempt.creds = { cookie: e.data.cookie, imei: e.data.imei, userAgent: e.data.userAgent, savedAt: new Date(now()).toISOString() };
          }
        })
        .then(
          async (next) => {
            clearTimeout(timer);
            if (attempt.abandoned) return;
            if (!attempt.creds) {
              failAttempt(new Error('Zalo không trả phiên đăng nhập'));
              return;
            }
            // Đăng nhập đã xong hẳn: lúc này mới đổi tài khoản mong muốn và lưu.
            const session: Session = { creds: attempt.creds };
            desired = session;
            sessionSaveError = null;
            reconnector.reset();
            // Giữ lượt này là lượt đang chạy tới khi attach xong, để qrStart trong lúc đang lưu nhập vào đây thay vì mở loginQR
            // thứ hai, và logout lúc này bỏ được lượt trước khi nó nghe tin. Chờ có hạn: CONNECTED không phụ thuộc đĩa.
            await waitAtMost(persistSession(session), ATTACH_SAVE_WAIT_MS);
            if (attempt.abandoned) return;
            try {
              await attach(next);
            } finally {
              finish();
            }
          },
          (e: unknown) => {
            clearTimeout(timer);
            if (attempt.abandoned) return;
            failAttempt(e);
          },
        )
        .catch((e: unknown) => console.error(`[zalo] lỗi sau khi quét QR: ${errMsg(e)}`));
    });
    attempt.first.catch(() => undefined);
    return attempt.first;
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
        displayName: ownProfile()?.displayName ?? null,
        avatar: ownProfile()?.avatar ?? null,
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
