'use client';

import type { HttpClient, RequestOptions } from '@tubutree/app-core/http';
import { apiFetch } from './client-api';
import { withQuery } from './core-query';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Không truyền gì thừa cho apiFetch: auth, refresh 401, timeout và lỗi ApiError/NetworkError giữ nguyên như trước.
function call<T>(method: Method, path: string, body: unknown, opts?: RequestOptions): Promise<T> {
  return apiFetch<T>(withQuery(path, opts?.query), {
    method,
    ...(body !== undefined ? { body } : {}),
    ...(opts?.headers ? { headers: opts.headers } : {}),
  });
}

export const coreHttp: HttpClient = {
  get: (path, opts) => call('GET', path, undefined, opts),
  post: (path, body, opts) => call('POST', path, body, opts),
  put: (path, body, opts) => call('PUT', path, body, opts),
  patch: (path, body, opts) => call('PATCH', path, body, opts),
  delete: (path, opts) => call('DELETE', path, undefined, opts),
};
