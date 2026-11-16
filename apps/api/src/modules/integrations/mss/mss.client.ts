import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MSS_API_PREFIX, isMssConfigured, readMssEnv } from './mss-config';
import { MSS_ENV_READER, type MssEnvReader } from './mss-flags';
import { MssCircuitBreaker, MSS_SHARED_STORE, type MssSharedStore } from './mss-circuit';
import { signMssRequest } from './mss-signer';

/** Hạn chờ mỗi lời gọi (hợp đồng order-events mục 3.1). Không tự thử lại: việc thử lại thuộc outbox của từng luồng. */
export const MSS_REQUEST_TIMEOUT_MS = 5_000;

export const MSS_FETCH = Symbol('MSS_FETCH');
export type MssFetch = (url: string, init: RequestInit) => Promise<Response>;

export type MssErrorKind =
  | 'not_configured'
  | 'circuit_open'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'stale_timestamp'
  | 'rate_limited'
  | 'unavailable'
  | 'server_error'
  | 'client_error'
  | 'invalid_response';

/** Thử lại được (theo lịch của outbox): MSS tạm không nhận, không phải MSS từ chối nội dung. */
const TRANSIENT_KINDS: ReadonlySet<MssErrorKind> = new Set(['circuit_open', 'timeout', 'network', 'stale_timestamp', 'rate_limited', 'unavailable', 'server_error']);
/** Lỗi tính vào cầu dao: MSS không trả lời được. 4xx (kể cả 401, 429) nghĩa là MSS vẫn sống. */
const CIRCUIT_KINDS: ReadonlySet<MssErrorKind> = new Set(['timeout', 'network', 'unavailable', 'server_error']);

export class MssRequestError extends Error {
  constructor(
    readonly kind: MssErrorKind,
    message: string,
    readonly details: { status?: number; code?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = 'MssRequestError';
  }

  get transient(): boolean {
    return TRANSIENT_KINDS.has(this.kind);
  }

  get status(): number | undefined {
    return this.details.status;
  }
}

export interface MssRequestOptions {
  /** Chuỗi đã tuần tự hoá sẵn (gửi đúng từng byte, ký đúng từng byte) hoặc object (tuần tự hoá một lần ở đây). */
  body?: string | object;
  /** Chỉ để ghi log và đối soát; không bao giờ ghi thân. */
  eventId?: string;
  /** Header `Idempotency-Key` (hợp đồng commerce mục 2.2). */
  idempotencyKey?: string;
  /** Nhãn ghi log thay cho đường dẫn (đường dẫn có thể chứa SĐT, ví dụ `/customers/{phone}`). */
  op?: string;
  timeoutMs?: number;
}

export interface MssResponse<T> {
  status: number;
  data: T | null;
  durationMs: number;
}

export interface MssHealthDoc {
  ok: boolean;
  capabilities: string[];
  /** v0.9 ghi chuỗi (`"0.9"`); MSS hiện trả object theo hợp đồng (`{"order_events":"1.2","commerce":"0.9"}`). */
  contract: string | Record<string, string> | null;
}

export type MssMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const CAPABILITY_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_CAPABILITIES = 50;

function opLabel(method: MssMethod, path: string): string {
  const seg = /^\/([a-z_-]{1,32})/.exec(path)?.[1] ?? '';
  return `${method} ${seg || '/'}`;
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : undefined;
}

export function parseHealthDoc(json: unknown): MssHealthDoc | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o.ok !== 'boolean') return null;
  const caps = Array.isArray(o.capabilities) ? o.capabilities.filter((c): c is string => typeof c === 'string' && CAPABILITY_RE.test(c)).slice(0, MAX_CAPABILITIES) : [];
  let contract: MssHealthDoc['contract'] = null;
  if (typeof o.contract === 'string') contract = o.contract.slice(0, 32);
  else if (o.contract && typeof o.contract === 'object' && !Array.isArray(o.contract)) {
    contract = Object.fromEntries(
      Object.entries(o.contract as Record<string, unknown>)
        .filter(([k, v]) => CAPABILITY_RE.test(k) && typeof v === 'string')
        .slice(0, 10)
        .map(([k, v]) => [k, (v as string).slice(0, 32)]),
    );
  }
  return { ok: o.ok, capabilities: [...new Set(caps)], contract };
}

/**
 * Gọi API MSS dành cho Tubu (`{MSS_BASE_URL}/api/ext/tubu/v1`), mỗi yêu cầu ký HMAC với timestamp mới. Không theo chuyển hướng,
 * không tự thử lại, không ghi thân yêu cầu/phản hồi vào log (chỉ nhãn thao tác, `eventId`, mã HTTP, thời lượng).
 */
@Injectable()
export class MssClient {
  private readonly logger = new Logger(MssClient.name);
  private readonly readEnv: MssEnvReader;
  private readonly fetchImpl: MssFetch;
  readonly circuit: MssCircuitBreaker;

  constructor(
    @Optional() @Inject(MSS_ENV_READER) readEnv?: MssEnvReader,
    @Optional() @Inject(MSS_FETCH) fetchImpl?: MssFetch,
    @Optional() @Inject(MSS_SHARED_STORE) store?: MssSharedStore,
  ) {
    this.readEnv = readEnv ?? (() => readMssEnv());
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
    this.circuit = new MssCircuitBreaker(store);
  }

  isConfigured(): boolean {
    return isMssConfigured(this.readEnv());
  }

  async request<T = unknown>(method: MssMethod, path: string, opts: MssRequestOptions = {}): Promise<MssResponse<T>> {
    if (!this.isConfigured()) throw new MssRequestError('not_configured', 'MSS chưa cấu hình đủ biến môi trường');
    const admission = await this.circuit.admit();
    if (admission === 'reject') throw new MssRequestError('circuit_open', 'Cầu dao MSS đang ngắt');
    if (admission === 'probe') {
      try {
        await this.health();
      } catch {
        throw new MssRequestError('circuit_open', 'Cầu dao MSS đang ngắt (dò /health chưa tốt)');
      }
    }
    return this.send<T>(method, path, opts);
  }

  /**
   * `GET /health` có ký. Đây cũng là lần dò của cầu dao: luôn được gửi kể cả khi cầu dao đang ngắt, MSS trả `ok: true` thì đóng
   * cầu dao. Người gọi định kỳ là MssHealthService (5 phút một lần, chỉ khi có cờ MSS bật). Khi cầu dao đang đóng, kết quả
   * `/health` không vào bộ đếm lỗi liên tiếp: bộ đếm chỉ phản ánh lời gọi nghiệp vụ, `/health` tốt không được xoá lỗi 5xx của chúng.
   */
  async health(): Promise<MssHealthDoc> {
    if (!this.isConfigured()) throw new MssRequestError('not_configured', 'MSS chưa cấu hình đủ biến môi trường');
    const probe = this.circuit.isTripped();
    let res: MssResponse<unknown>;
    try {
      // Cầu dao do chính hàm này ghi: lần dò mà MSS trả 401/4xx vẫn là dò hỏng, không được đóng cầu dao.
      res = await this.send<unknown>('GET', '/health', { op: 'GET health' }, false);
    } catch (err) {
      if (probe) this.circuit.recordFailure(err instanceof MssRequestError ? err.kind : 'internal');
      throw err;
    }
    const doc = parseHealthDoc(res.data);
    if (!doc || !doc.ok) {
      if (probe) this.circuit.recordFailure('invalid_response');
      throw new MssRequestError('invalid_response', 'MSS /health không trả ok', { status: res.status });
    }
    if (probe) this.circuit.recordSuccess();
    return doc;
  }

  private buildUrl(base: string, path: string): string {
    if (!PATH_RE.test(path) || path.includes('..') || path.startsWith('//')) throw new Error(`Đường dẫn MSS không hợp lệ: ${opLabel('GET', path)}`);
    return `${base}${MSS_API_PREFIX}${path}`;
  }

  private async send<T>(method: MssMethod, path: string, opts: MssRequestOptions, trackCircuit = true): Promise<MssResponse<T>> {
    const env = this.readEnv();
    const url = this.buildUrl(env.baseUrl!, path);
    const op = opts.op ?? opLabel(method, path);
    const rawBody = opts.body === undefined ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...signMssRequest({ keyId: env.keyId!, secret: env.outboundSecret!, rawBody }),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? MSS_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const tag = `MSS ${op}${opts.eventId ? ` event ${opts.eventId}` : ''}`;
    const fail = (err: MssRequestError): never => {
      const ms = Date.now() - started;
      if (trackCircuit) {
        if (CIRCUIT_KINDS.has(err.kind)) this.circuit.recordFailure(err.kind);
        else this.circuit.recordSuccess();
      }
      this.logger.warn(`${tag}: ${err.kind}${err.status ? ` HTTP ${err.status}` : ''}${err.details.code ? ` (${err.details.code})` : ''} ${ms}ms`);
      throw err;
    };
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: method === 'GET' || opts.body === undefined ? undefined : rawBody, redirect: 'manual', signal: controller.signal });
      } catch (err) {
        const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
        return fail(new MssRequestError(aborted ? 'timeout' : 'network', aborted ? `Quá ${timeoutMs}ms chưa có phản hồi` : 'Lỗi mạng khi gọi MSS'));
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        return fail(new MssRequestError(controller.signal.aborted ? 'timeout' : 'network', 'Không đọc được phản hồi MSS', { status: res.status }));
      }
      let json: unknown = null;
      let parsed = text.length === 0;
      if (text.length > 0) {
        try {
          json = JSON.parse(text);
          parsed = true;
        } catch {
          parsed = false;
        }
      }
      const status = res.status;
      const durationMs = Date.now() - started;
      if (status >= 200 && status < 300) {
        if (!parsed) return fail(new MssRequestError('invalid_response', 'Phản hồi MSS không phải JSON', { status }));
        if (trackCircuit) this.circuit.recordSuccess();
        this.logger.debug(`${tag}: HTTP ${status} ${durationMs}ms`);
        return { status, data: json as T | null, durationMs };
      }
      const rawCode = json && typeof json === 'object' ? (json as Record<string, unknown>).error : undefined;
      const code = typeof rawCode === 'string' && ERROR_CODE_RE.test(rawCode) ? rawCode : undefined;
      const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
      const details = { status, code, retryAfterSec };
      if (status === 401) return fail(new MssRequestError(code === 'stale_timestamp' ? 'stale_timestamp' : 'unauthorized', 'MSS từ chối chữ ký', details));
      if (status === 429) return fail(new MssRequestError('rate_limited', 'MSS giới hạn tần suất', details));
      if (status === 503) return fail(new MssRequestError('unavailable', 'MSS tạm không nhận', details));
      if (status >= 500) return fail(new MssRequestError('server_error', 'MSS lỗi máy chủ', details));
      return fail(new MssRequestError('client_error', 'MSS từ chối yêu cầu', details));
    } finally {
      clearTimeout(timer);
    }
  }
}
