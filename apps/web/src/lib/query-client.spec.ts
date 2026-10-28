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

describe('createQueryClient (R-80)', () => {
  it('danh mục sản phẩm tươi 60 giây (cùng giá trị với Mini App), khoá khác không đổi', () => {
    const client = createQueryClient();
    expect(client.defaultQueryOptions({ queryKey: ['products', 'home-featured'] }).staleTime).toBe(60_000);
    expect(client.defaultQueryOptions({ queryKey: ['cart'] }).staleTime).toBeUndefined();
  });
});
