import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { createQueryClient } from './query-client';
import { getErrorMessage } from './api';
import { vi as copy } from '../i18n/vi';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe('createQueryClient — mất mạng khi bấm Đặt hàng (R4-BUYER-1)', () => {
  it('mutation chạy ngay cả khi onlineManager báo offline: gọi request thật, lỗi mạng rơi vào onError, không xếp hàng chờ', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    vi.stubGlobal('navigator', { onLine: false });
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK');
    const mutationFn = vi.fn().mockRejectedValue(networkError);
    const onError = vi.fn();

    const observer = new MutationObserver(client, { mutationFn, onError });
    await expect(observer.mutate()).rejects.toBe(networkError);

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect(getErrorMessage(onError.mock.calls[0]![0])).toBe(copy.errors.offline);
  });

  it('có mạng lại thì không tự gửi lại mutation đã lỗi lúc offline (không tự đặt đơn sau đó)', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    const observer = new MutationObserver(client, { mutationFn });
    await observer.mutate().catch(() => undefined);

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it('query vẫn giữ mặc định cũ: không retry lỗi 4xx, retry 1 lần cho lỗi mạng', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    const err4xx = new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status: 404 } as never);
    expect(retry(0, err4xx)).toBe(false);
    expect(retry(0, new AxiosError('x', 'ERR_NETWORK'))).toBe(true);
    expect(retry(1, new AxiosError('x', 'ERR_NETWORK'))).toBe(false);
  });
});
