import type { HttpClient, RequestOptions } from '@tubutree/app-core/http';
import { ApiUnavailableError } from './api';
import { withQuery } from './core-query';

// Cùng nguồn BASE như lib/api.ts (API_BASE_URL đổi được lúc deploy không cần rebuild).
const BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const DEFAULT_REVALIDATE_S = 300;

/** API trả 404: tài nguyên không có thật, khác với lỗi tạm (ApiUnavailableError) — trang gọi notFound(). */
export class ApiNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`API ${path} không tìm thấy`);
    this.name = 'ApiNotFoundError';
  }
}

// Mọi request SSR đi từ một IP container web; không có token bypass thì cả site chung một bộ đếm throttle (xem lib/api.ts).
function serverHeaders(extra: Record<string, string> | undefined): Record<string, string> | undefined {
  const token = typeof window === 'undefined' ? process.env.THROTTLE_BYPASS_TOKEN : undefined;
  if (!token) return extra;
  return { ...extra, 'x-throttle-bypass': token };
}

function readOnly(): Promise<never> {
  return Promise.reject(new Error('createServerHttp chỉ đọc: server component không ghi dữ liệu, dùng coreHttp ở client.'));
}

/**
 * HttpClient cho server component và trang ISR. Lỗi mạng và 429/5xx ném ApiUnavailableError (Next giữ bản đã render
 * thay vì lưu trang rỗng), 404 ném ApiNotFoundError. Chỉ `get` dùng được.
 */
export function createServerHttp(init?: { revalidate?: number }): HttpClient {
  const revalidate = init?.revalidate ?? DEFAULT_REVALIDATE_S;
  return {
    async get<T>(path: string, opts?: RequestOptions): Promise<T> {
      const full = withQuery(path, opts?.query);
      const headers = serverHeaders(opts?.headers);
      let res: Response;
      try {
        res = await fetch(`${BASE}${full}`, { next: { revalidate }, ...(headers ? { headers } : {}) });
      } catch (err) {
        throw new ApiUnavailableError(full, null, { cause: err });
      }
      if (res.status === 404) throw new ApiNotFoundError(full);
      if (!res.ok) throw new ApiUnavailableError(full, res.status);
      return (await res.json()) as T;
    },
    post: readOnly,
    put: readOnly,
    patch: readOnly,
    delete: readOnly,
  };
}
