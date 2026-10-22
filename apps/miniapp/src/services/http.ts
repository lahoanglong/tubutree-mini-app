/**
 * Lớp HTTP mỏng trên fetch (thay axios để gói đầu nhẹ hơn). Chỉ lo phần vận chuyển: ghép URL,
 * query, body, timeout, đọc JSON, đổi lỗi thành HttpError. Chuyện phiên/token/429 nằm ở api.ts.
 */

export interface HttpErrorResponse {
  status: number;
  data?: unknown;
  /** Tên header viết thường. */
  headers?: Record<string, string>;
}

/**
 * Lỗi của mọi lời gọi API. Giữ đúng hình dạng mà code gọi đã dùng với axios (`response.status`,
 * `response.data`, `code`) để các màn không phải đổi cách đọc lỗi.
 * - Có `response`: máy chủ đã trả lời mã ngoài 2xx.
 * - Không có `response`: `code` = 'ECONNABORTED' (quá thời gian) hoặc 'ERR_NETWORK' (không tới được máy chủ).
 */
export class HttpError extends Error {
  /** Dấu nhận diện thay cho instanceof: vẫn đúng khi module bị nạp hai bản hoặc lỗi đi qua mock. */
  readonly isHttpError = true;
  readonly code: string | undefined;
  readonly response: HttpErrorResponse | undefined;

  constructor(message: string, code?: string, response?: HttpErrorResponse) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.response = response;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return typeof error === 'object' && error !== null && (error as { isHttpError?: unknown }).isHttpError === true;
}

export interface RequestConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Mili giây; 0 = không giới hạn. Mặc định lấy từ createTransport. */
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  /** Tên header viết thường. */
  headers: Record<string, string>;
}

export interface TransportRequest {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers: Headers;
  timeout?: number;
}

// Giữ đúng cách mã hoá của axios 1.x: máy chủ và các spec đã quen "a+b", "ids[]=1", "a:b".
function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%20/g, '+')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']');
}

function collect(key: string, value: unknown, out: string[]): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(`${key}[]`, item, out);
    return;
  }
  if (value instanceof Date) {
    out.push(`${encode(key)}=${encode(value.toISOString())}`);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(`${key}[${k}]`, v, out);
    return;
  }
  out.push(`${encode(key)}=${encode(String(value))}`);
}

export function buildUrl(baseURL: string, url: string, params?: Record<string, unknown>): string {
  const absolute = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
  const full = absolute ? url : `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params ?? {})) collect(key, value, parts);
  if (parts.length === 0) return full;
  return `${full}${full.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

function isRawBody(data: unknown): boolean {
  return (
    typeof data === 'string' ||
    (typeof FormData !== 'undefined' && data instanceof FormData) ||
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
    data instanceof ArrayBuffer
  );
}

function encodeBody(data: unknown, headers: Headers): BodyInit | undefined {
  if (data === undefined || data === null) {
    headers.delete('Content-Type');
    return undefined;
  }
  if (isRawBody(data)) {
    // multipart cần boundary do trình duyệt sinh; header người gọi tự đặt sẽ làm hỏng nó.
    if (typeof FormData !== 'undefined' && data instanceof FormData) headers.delete('Content-Type');
    return data as BodyInit;
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(data);
}

/** JSON nếu parse được, không thì giữ nguyên chuỗi (trang HTML của proxy); thân rỗng → ''. */
function parseBody(text: string): unknown {
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createTransport(baseURL: string, defaultTimeoutMs: number) {
  return async function send<T>(req: TransportRequest): Promise<HttpResponse<T>> {
    const url = buildUrl(baseURL, req.url, req.params);
    const body = encodeBody(req.data, req.headers);
    const timeoutMs = req.timeout ?? defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;

    let status: number;
    const headers: Record<string, string> = {};
    let text: string;
    try {
      const res = await fetch(url, { method: req.method, headers: req.headers, body, signal: controller.signal });
      status = res.status;
      res.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      text = await res.text();
    } catch {
      throw timedOut
        ? new HttpError(`timeout of ${timeoutMs}ms exceeded`, 'ECONNABORTED')
        : new HttpError('Network Error', 'ERR_NETWORK');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const data = parseBody(text);
    if (status < 200 || status >= 300) {
      throw new HttpError(
        `Request failed with status code ${status}`,
        status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
        { status, data, headers },
      );
    }
    return { data: data as T, status, headers };
  };
}
