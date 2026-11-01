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
