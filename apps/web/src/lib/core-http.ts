'use client';

import type { HttpClient, RequestOptions } from '@tubutree/app-core/http';
import { apiFetch } from './client-api';
import { withQuery } from './core-query';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Không truyền gì thừa cho apiFetch: auth, refresh 401, timeout và lỗi ApiError/NetworkError giữ nguyên như trước.
// async để mọi lỗi (kể cả URIError khi dựng query) thành promise bị từ chối như axios bên Mini App, không ném đồng bộ.
async function call<T>(method: Method, path: string, body: unknown, opts?: RequestOptions): Promise<T> {
  return apiFetch<T>(withQuery(path, opts?.query), {
    method,
    ...(body !== undefined ? { body } : {}),
    ...(opts?.headers ? { headers: opts.headers } : {}),
    ...(opts?.anonymous ? { auth: false, cache: 'no-store' as const } : {}),
  });
}

export const rawCoreHttp: HttpClient = {
  get: (path, opts) => call('GET', path, undefined, opts),
  post: (path, body, opts) => call('POST', path, body, opts),
  put: (path, body, opts) => call('PUT', path, body, opts),
  patch: (path, body, opts) => call('PATCH', path, body, opts),
  delete: (path, opts) => call('DELETE', path, undefined, opts),
};

/** Nơi Trang chủ nhận khối đã có sẵn trong request gộp (`lib/home-feed.ts`); null = request lẻ như thường. */
type GetInterceptor = (path: string, query: RequestOptions['query']) => Promise<unknown | null> | null;
let getInterceptor: GetInterceptor | null = null;
export function setCoreGetInterceptor(fn: GetInterceptor | null): void {
  getInterceptor = fn;
}

export const coreHttp: HttpClient = {
  get: async <T,>(path: string, opts?: RequestOptions) => {
    const taken = getInterceptor?.(path, opts?.query);
    if (taken) {
      const block = await taken;
      if (block != null) return block as T;
    }
    return rawCoreHttp.get<T>(path, opts);
  },
  post: rawCoreHttp.post,
  put: rawCoreHttp.put,
  patch: rawCoreHttp.patch,
  delete: rawCoreHttp.delete,
};
