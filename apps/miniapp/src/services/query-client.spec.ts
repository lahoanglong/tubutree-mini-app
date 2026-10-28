import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './http';
import { MutationObserver, QueryObserver, focusManager, onlineManager } from '@tanstack/react-query';
import { createQueryClient } from './query-client';
import { getErrorMessage } from './api';
import { vi as copy } from '../i18n/vi';

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

describe('createQueryClient — mất mạng khi bấm Đặt hàng (R4-BUYER-1)', () => {
  it('mutation chạy ngay cả khi onlineManager báo offline: gọi request thật, lỗi mạng rơi vào onError, không xếp hàng chờ', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    vi.stubGlobal('navigator', { onLine: false });
    const networkError = new HttpError('Network Error', 'ERR_NETWORK');
    const mutationFn = vi.fn().mockRejectedValue(networkError);
    const onError = vi.fn();

    const observer = new MutationObserver(client, { mutationFn, onError });
    await expect(observer.mutate(undefined)).rejects.toBe(networkError);

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect(getErrorMessage(onError.mock.calls[0]![0])).toBe(copy.errors.offline);
  });

  it('có mạng lại thì không tự gửi lại mutation đã lỗi lúc offline (không tự đặt đơn sau đó)', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    const observer = new MutationObserver(client, { mutationFn });
    await observer.mutate(undefined).catch(() => undefined);

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it('query vẫn giữ mặc định cũ: không retry lỗi 4xx, retry 1 lần cho lỗi mạng', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    const err4xx = new HttpError('x', 'ERR_BAD_REQUEST', { status: 404 });
    expect(retry(0, err4xx)).toBe(false);
    expect(retry(0, new HttpError('x', 'ERR_NETWORK'))).toBe(true);
    expect(retry(1, new HttpError('x', 'ERR_NETWORK'))).toBe(false);
  });
});

describe('createQueryClient — truy vấn lúc mất mạng (R5-BUYER-1)', () => {
  const networkError = () => new HttpError('Network Error', 'ERR_NETWORK');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('offline: truy vấn chưa có dữ liệu vẫn chạy và hạ xuống trạng thái lỗi ngay, không kẹt ở "tạm dừng" (trang đọc được isError thay vì vẽ màn trống)', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    vi.stubGlobal('navigator', { onLine: false });
    const queryFn = vi.fn().mockRejectedValue(networkError());

    const observer = new QueryObserver(client, { queryKey: ['orders'], queryFn });
    const unsub = observer.subscribe(() => undefined);
    await tick();
    await tick();
    unsub();

    const r = observer.getCurrentResult();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(r.fetchStatus).toBe('idle');
    expect(r.isError).toBe(true);
    expect(getErrorMessage(r.error)).toBe(copy.errors.offline);
  });

  it('có mạng lại: truy vấn đang lỗi tự tải lại, hết lỗi thì có dữ liệu', async () => {
    const client = createQueryClient();
    client.mount();
    onlineManager.setOnline(false);
    vi.stubGlobal('navigator', { onLine: false });
    const queryFn = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(['đơn 1']);
    const observer = new QueryObserver(client, { queryKey: ['orders'], queryFn });
    const unsub = observer.subscribe(() => undefined);
    await tick();
    await tick();
    expect(observer.getCurrentResult().isError).toBe(true);

    vi.stubGlobal('navigator', { onLine: true });
    onlineManager.setOnline(true);
    await tick();
    await tick();
    unsub();

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual(['đơn 1']);
    expect(observer.getCurrentResult().isError).toBe(false);
  });

  it('quay lại app: truy vấn đang lỗi mạng/5xx tải lại, truy vấn đã có dữ liệu thì không tải thừa', async () => {
    const client = createQueryClient();
    client.mount();
    const failing = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue('ok');
    const healthy = vi.fn().mockResolvedValue('có rồi');
    const retryOff = { retry: false } as const;
    const a = new QueryObserver(client, { queryKey: ['cart'], queryFn: failing, ...retryOff });
    const b = new QueryObserver(client, { queryKey: ['wishlist'], queryFn: healthy, staleTime: 0, ...retryOff });
    const unsubA = a.subscribe(() => undefined);
    const unsubB = b.subscribe(() => undefined);
    await tick();
    await tick();
    expect(a.getCurrentResult().isError).toBe(true);
    expect(healthy).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await tick();
    await tick();
    unsubA();
    unsubB();

    expect(failing).toHaveBeenCalledTimes(2);
    expect(a.getCurrentResult().data).toBe('ok');
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('lỗi 4xx nghiệp vụ (vd 404) không bị tải lại mỗi lần quay lại app', async () => {
    const client = createQueryClient();
    client.mount();
    const notFound = new HttpError('x', 'ERR_BAD_REQUEST', { status: 404 });
    const queryFn = vi.fn().mockRejectedValue(notFound);
    const observer = new QueryObserver(client, { queryKey: ['order', 'x'], queryFn, retry: false });
    const unsub = observer.subscribe(() => undefined);
    await tick();
    await tick();

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await tick();
    unsub();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('offline thì không retry (thử lại chỉ tốn thời gian chờ); có mạng mà lỗi mạng vẫn retry 1 lần', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    vi.stubGlobal('navigator', { onLine: false });
    expect(retry(0, networkError())).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect(retry(0, networkError())).toBe(true);
  });
});

describe('createQueryClient — staleTime danh sách sản phẩm (R-80)', () => {
  it('products, for-you, categories, brands tươi 60 giây; khoá khác giữ 10 giây', () => {
    const client = createQueryClient();
    const stale = (key: unknown[]) => client.defaultQueryOptions({ queryKey: key }).staleTime;
    expect(stale(['products', 'home-best-seller'])).toBe(60_000);
    expect(stale(['products', 'browse', 'x'])).toBe(60_000);
    expect(stale(['for-you'])).toBe(60_000);
    expect(stale(['categories'])).toBe(60_000);
    expect(stale(['brands'])).toBe(60_000);
    expect(stale(['cart'])).toBe(10_000);
  });
});

describe('getErrorMessage — không có phản hồi (R-85)', () => {
  it('đang online mà không có phản hồi: câu trung tính, không đổ lỗi cho máy chủ', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const msg = getErrorMessage(new HttpError('Network Error', 'ERR_NETWORK'));
    expect(msg).toBe(copy.errors.network);
    expect(msg).not.toContain('Máy chủ');
  });
  it('5xx vẫn nói máy chủ bận', () => {
    expect(getErrorMessage(new HttpError('x', 'ERR_BAD_RESPONSE', { status: 503, data: {} }))).toBe(copy.errors.server);
  });
});
