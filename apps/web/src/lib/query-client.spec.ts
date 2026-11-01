import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { createQueryClient, shouldRetryQuery } from './query-client';

describe('shouldRetryQuery (R-80)', () => {
  it('không thử lại lỗi 4xx', () => {
    expect(shouldRetryQuery(0, new ApiError('Không tìm thấy', 404))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('x', 401))).toBe(false);
  });
  it('thử lại đúng một lần cho 5xx và mất mạng', () => {
    expect(shouldRetryQuery(0, new ApiError('x', 503))).toBe(true);
    expect(shouldRetryQuery(0, new NetworkError(false))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError('x', 503))).toBe(false);
  });
});

const staleOf = (client: ReturnType<typeof createQueryClient>, queryKey: unknown[]) => {
  const t = client.defaultQueryOptions({ queryKey }).staleTime as unknown;
  return typeof t === 'function' ? (t as (q: unknown) => number)({ queryKey }) : t;
};

describe('createQueryClient (R-80)', () => {
  it('danh mục sản phẩm tươi 60 giây (cùng giá trị với Mini App), khoá khác không đổi', () => {
    const client = createQueryClient();
    expect(client.defaultQueryOptions({ queryKey: ['products', 'home-featured'] }).staleTime).toBe(60_000);
    expect(staleOf(client, ['cart'])).toBe(0);
  });

  it('khoá admin và huy hiệu hoàn tiền tươi 30 giây (đổi tab qua lại không gọi lại mạng)', () => {
    const client = createQueryClient();
    for (const key of [['admin-orders', 1], ['admin-ops-inbox'], ['admin-customer-refunds', 'OPEN', 'count'], ['admin-dealers', 'PENDING']]) {
      expect(staleOf(client, key)).toBe(30_000);
    }
    expect(staleOf(client, ['orders-mine'])).toBe(0);
    expect(staleOf(client, ['products', 'x'])).toBe(60_000);
  });
});

describe('đổi qua lại giữa hai tab admin (R-149)', () => {
  // Mỗi lần mở tab là mount lại truy vấn của tab đó: staleTime 0 thì lần nào cũng gọi mạng.
  async function switchTabs(client: ReturnType<typeof createQueryClient> | QueryClient, rounds: number) {
    const calls = { orders: 0, dealers: 0 };
    const fetchers = {
      orders: ['admin-orders', 1] as const,
      dealers: ['admin-dealers', 'PENDING'] as const,
    };
    const open = async (name: keyof typeof calls) => {
      const obs = new QueryObserver(client, {
        queryKey: [...fetchers[name]],
        queryFn: async () => (calls[name] += 1),
      });
      const unsub = obs.subscribe(() => undefined);
      await new Promise((r) => setTimeout(r, 0));
      unsub();
    };
    for (let i = 0; i < rounds; i++) {
      await open('orders');
      await open('dealers');
    }
    return calls.orders + calls.dealers;
  }

  it('3 vòng Đơn ↔ Đại lý: trước 6 lần gọi mạng, sau 2 lần (mỗi tab một lần)', async () => {
    const before = await switchTabs(new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }), 3);
    const after = await switchTabs(createQueryClient(), 3);
    expect(before).toBe(6);
    expect(after).toBe(2);
  });
});
