import { describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
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

  it('cấu hình công khai tươi 5 phút cho mọi trang (không gọi /config/public hai lần khi chuyển trang)', () => {
    const client = createQueryClient();
    expect(staleOf(client, ['public-config'])).toBe(5 * 60_000);
    expect(staleOf(client, ['me'])).toBe(0);
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

describe('createQueryClient — làm mới số đếm /me/summary', () => {
  const stale = (client: ReturnType<typeof createQueryClient>) => client.getQueryState(['me-summary'])?.isInvalidated === true;
  const seed = () => {
    const client = createQueryClient();
    client.setQueryData(['me-summary'], { orders: { active: 1 } });
    return client;
  };

  it.each([['orders'], ['orders', 'list', 'all'], ['notifications'], ['subscriptions']])('làm mới %j đánh dấu summary cũ', async (...key) => {
    const client = seed();
    await client.invalidateQueries({ queryKey: key });
    expect(stale(client)).toBe(true);
  });

  it.each([['wallet'], ['products'], ['coupons'], ['me']])('làm mới %j không đụng summary (Vườn Xanh làm mới ["me"] sau mỗi lần tưới)', async (...key) => {
    const client = seed();
    await client.invalidateQueries({ queryKey: key });
    expect(stale(client)).toBe(false);
  });

  it('làm mới không kèm khoá (mọi truy vấn) cũng làm cũ summary', async () => {
    const client = seed();
    await client.invalidateQueries();
    expect(stale(client)).toBe(true);
  });
});

describe('mutation chỉ làm mới các khoá admin mà nó khai (F6)', () => {
  type Meta = { skipAdminInvalidate?: boolean; adminInvalidate?: readonly string[] };
  const setup = async (keys: (string | number)[][]) => {
    const client = createQueryClient();
    const fns = new Map<string, ReturnType<typeof vi.fn>>();
    const unsubs: Array<() => void> = [];
    for (const key of keys) {
      const fn = vi.fn(async () => key.join('/'));
      fns.set(key[0] as string, fn);
      const obs = new QueryObserver(client, { queryKey: key, queryFn: fn });
      unsubs.push(obs.subscribe(() => undefined));
    }
    await vi.waitFor(() => expect([...fns.values()].every((f) => f.mock.calls.length === 1)).toBe(true));
    const run = async (meta?: Meta) => {
      await client.getMutationCache().build(client, { mutationFn: async () => 'ok', meta }).execute(undefined);
      await new Promise((r) => setTimeout(r, 20));
    };
    const calls = (k: string) => fns.get(k)!.mock.calls.length;
    return { client, run, calls, done: () => unsubs.forEach((u) => u()) };
  };

  it('skipAdminInvalidate: không queryFn admin nào chạy lại', async () => {
    const t = await setup([['admin-a'], ['admin-b'], ['public-x']]);
    await t.run({ skipAdminInvalidate: true });
    expect([t.calls('admin-a'), t.calls('admin-b'), t.calls('public-x')]).toEqual([1, 1, 1]);
    t.done();
  });

  it("adminInvalidate: ['admin-a'] chỉ chạy lại admin-a", async () => {
    const t = await setup([['admin-a', 1], ['admin-b'], ['public-x']]);
    await t.run({ adminInvalidate: ['admin-a'] });
    expect([t.calls('admin-a'), t.calls('admin-b'), t.calls('public-x')]).toEqual([2, 1, 1]);
    t.done();
  });

  it('adminInvalidate khớp đúng tên khoá đầu, không khớp theo tiền tố chuỗi (admin-user không kéo admin-users)', async () => {
    const t = await setup([['admin-user'], ['admin-users']]);
    await t.run({ adminInvalidate: ['admin-user'] });
    expect([t.calls('admin-user'), t.calls('admin-users')]).toEqual([2, 1]);
    t.done();
  });

  it('không khai gì: chạy lại mọi admin-*, khoá public không bị đụng', async () => {
    const t = await setup([['admin-a'], ['admin-b'], ['public-x']]);
    await t.run();
    expect([t.calls('admin-a'), t.calls('admin-b'), t.calls('public-x')]).toEqual([2, 2, 1]);
    t.done();
  });

  it('adminInvalidate rỗng và skipAdminInvalidate cùng khai: skip thắng', async () => {
    const t = await setup([['admin-a']]);
    await t.run({ skipAdminInvalidate: true, adminInvalidate: ['admin-a'] });
    expect(t.calls('admin-a')).toBe(1);
    t.done();
  });
});
