import type { HttpClient, RequestOptions } from '../http';

export interface RecordedCall {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  body?: unknown;
  opts?: RequestOptions;
}

/** HttpClient giả cho spec hợp đồng: ghi lại mọi lời gọi, trả về `respond(call)` (mặc định undefined). */
export function fakeHttp(respond: (call: RecordedCall) => unknown = () => undefined) {
  const calls: RecordedCall[] = [];
  const record = (call: RecordedCall) => {
    calls.push(call);
    try {
      return Promise.resolve(respond(call));
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const http = {
    get: (path: string, opts?: RequestOptions) => record({ method: 'get', path, ...(opts ? { opts } : {}) }),
    delete: (path: string, opts?: RequestOptions) => record({ method: 'delete', path, ...(opts ? { opts } : {}) }),
    post: (path: string, body?: unknown, opts?: RequestOptions) =>
      record({ method: 'post', path, ...(body !== undefined ? { body } : {}), ...(opts ? { opts } : {}) }),
    put: (path: string, body?: unknown, opts?: RequestOptions) =>
      record({ method: 'put', path, ...(body !== undefined ? { body } : {}), ...(opts ? { opts } : {}) }),
    patch: (path: string, body?: unknown, opts?: RequestOptions) =>
      record({ method: 'patch', path, ...(body !== undefined ? { body } : {}), ...(opts ? { opts } : {}) }),
  } as unknown as HttpClient;
  return { http, calls };
}
