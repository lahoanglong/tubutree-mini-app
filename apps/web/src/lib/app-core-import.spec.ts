import { describe, expect, it } from 'vitest';
import { CASHBACK_ENABLED, SEASON_PASS_ENABLED } from '@tubutree/app-core/features';
import type { HttpClient, Query, RequestOptions } from '@tubutree/app-core/http';

describe('nạp @tubutree/app-core từ web', () => {
  it('đọc được hằng số features', () => {
    expect(SEASON_PASS_ENABLED).toBe(false);
    expect(CASHBACK_ENABLED).toBe(false);
  });

  it('dùng được kiểu HttpClient', async () => {
    const query: Query = { page: 1, q: undefined };
    const opts: RequestOptions = { query, headers: { 'Idempotency-Key': 'k' } };
    const http: HttpClient = {
      get: async <T>() => ({ ok: true }) as T,
      post: async <T>() => ({ ok: true }) as T,
      put: async <T>() => ({ ok: true }) as T,
      patch: async <T>() => ({ ok: true }) as T,
      delete: async <T>() => ({ ok: true }) as T,
    };
    expect(await http.get('/x', opts)).toEqual({ ok: true });
  });
});
