import type { HttpClient, RequestOptions } from '@tubutree/app-core/http';
import { api } from './api';
import type { RequestConfig } from './http';

// Chỉ đưa cho api đúng thứ người gọi truyền: spec service đang kiểm mảng đối số (`['/waste/me']`, `['/x', { params: {} }]`).
function toConfig(opts: RequestOptions | undefined): RequestConfig | undefined {
  if (!opts || (opts.query === undefined && opts.headers === undefined)) return undefined;
  return {
    ...(opts.query !== undefined ? { params: opts.query } : {}),
    ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
  };
}

function withBody<T>(
  send: (...args: unknown[]) => Promise<{ data: T }>,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<T> {
  const cfg = toConfig(opts);
  const args = cfg ? [path, body, cfg] : body !== undefined ? [path, body] : [path];
  return send(...args).then((r) => r.data);
}

function withoutBody<T>(
  send: (...args: unknown[]) => Promise<{ data: T }>,
  path: string,
  opts: RequestOptions | undefined,
): Promise<T> {
  const cfg = toConfig(opts);
  return send(...(cfg ? [path, cfg] : [path])).then((r) => r.data);
}

export const coreHttp: HttpClient = {
  get: <T>(path: string, opts?: RequestOptions) => withoutBody<T>((...a) => api.get(...(a as [string])), path, opts),
  delete: <T>(path: string, opts?: RequestOptions) => withoutBody<T>((...a) => api.delete(...(a as [string])), path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => withBody<T>((...a) => api.post(...(a as [string])), path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => withBody<T>((...a) => api.put(...(a as [string])), path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => withBody<T>((...a) => api.patch(...(a as [string])), path, body, opts),
};
