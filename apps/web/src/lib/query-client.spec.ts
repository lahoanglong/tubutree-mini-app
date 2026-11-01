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
    // Dữ liệu sống (chat, chấm công trực tiếp) luôn coi là cũ để quay lại cửa sổ là làm mới.
    expect(staleOf(client, ['admin-support-conversations', '', false])).toBe(0);
    expect(staleOf(client, ['admin-support-conversation', 'c1'])).toBe(0);
    expect(staleOf(client, ['admin-attendance-live'])).toBe(0);
    expect(staleOf(client, ['orders-mine'])).toBe(0);
    expect(staleOf(client, ['products', 'x'])).toBe(60_000);
  });
});

describe('mutation thành công làm cũ mọi khoá admin (R-149)', () => {
  it('khoá admin-* đang tươi bị đánh dấu cũ sau một mutation, khoá khác giữ nguyên', async () => {
    const client = createQueryClient();
    client.setQueryData(['admin-users', 1], { name: 'cũ' });
    client.setQueryData(['admin-user-detail', 'u1'], { name: 'cũ' });
    client.setQueryData(['products', 'x'], []);
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(false);
    await client.getMutationCache().build(client, { mutationFn: async () => 'ok' }).execute(undefined);
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['admin-user-detail', 'u1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['products', 'x'])?.isInvalidated).toBe(false);
  });

  it('mutation lỗi cũng làm cũ khoá admin (dữ liệu có thể đã đổi phía máy chủ)', async () => {
    const client = createQueryClient();
    client.setQueryData(['admin-ops-inbox'], { items: [] });
    await client.getMutationCache().build(client, { mutationFn: async () => { throw new Error('x'); } }).execute(undefined).catch(() => undefined);
    expect(client.getQueryState(['admin-ops-inbox'])?.isInvalidated).toBe(true);
  });
});

describe('mutation đánh dấu không ghi gì thì không làm cũ khoá admin (R-188)', () => {
  const run = (client: ReturnType<typeof createQueryClient>, mutationFn: () => Promise<unknown>, meta?: { skipAdminInvalidate?: boolean }) =>
    client.getMutationCache().build(client, { mutationFn, meta }).execute(undefined);

  it('có cờ skipAdminInvalidate: thành công hay lỗi đều không invalidate', async () => {
    const client = createQueryClient();
    client.setQueryData(['admin-users', 1], { name: 'cũ' });
    await run(client, async () => 'ok', { skipAdminInvalidate: true });
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(false);
    await run(client, async () => { throw new Error('x'); }, { skipAdminInvalidate: true }).catch(() => undefined);
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(false);
  });

  it('không cờ (hoặc cờ false): vẫn invalidate cả khi thành công lẫn khi lỗi', async () => {
    const client = createQueryClient();
    client.setQueryData(['admin-users', 1], { name: 'cũ' });
    await run(client, async () => 'ok');
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(true);
    client.setQueryData(['admin-users', 1], { name: 'mới' });
    await run(client, async () => { throw new Error('x'); }, { skipAdminInvalidate: false }).catch(() => undefined);
    expect(client.getQueryState(['admin-users', 1])?.isInvalidated).toBe(true);
  });
});
