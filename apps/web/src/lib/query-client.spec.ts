import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { createQueryClient } from './query-client';
import { NetworkError } from './client-api';

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('createQueryClient — mất mạng khi bấm Đặt hàng (R4-BUYER-1 cho web)', () => {
  it('mutation chạy ngay cả khi trình duyệt báo offline: gọi request thật, lỗi mạng rơi vào onError, không xếp hàng chờ', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const offline = new NetworkError(false);
    const mutationFn = vi.fn().mockRejectedValue(offline);
    const onError = vi.fn();

    const observer = new MutationObserver(client, { mutationFn, onError });
    await expect(observer.mutate(undefined)).rejects.toBe(offline);

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.');
  });

  it('có mạng lại thì không tự gửi lại mutation đã lỗi lúc offline (không tự đặt đơn sau đó)', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockRejectedValue(new NetworkError(false));
    const observer = new MutationObserver(client, { mutationFn });
    await observer.mutate(undefined).catch(() => undefined);

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it('query giữ mặc định cũ: retry 1 lần, không tải lại khi quay lại tab', () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    expect(queries).toMatchObject({ retry: 1, refetchOnWindowFocus: false });
    expect(queries?.networkMode).toBeUndefined();
  });
});
