import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useBlockQuery } from './use-block-query';

function setup(queryFn: () => Promise<string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn })), { wrapper });
  return { qc, ...hook };
}

describe('useBlockQuery', () => {
  it('lần tải đầu: isLoading; lỗi: isError + error; tải lại khi đang lỗi: giữ isError/error, isLoading=false, isFetching=true', async () => {
    const boom = new Error('boom');
    let release: (v: string) => void = () => {};
    const fn = vi.fn().mockRejectedValueOnce(boom).mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    const { result, qc } = setup(fn);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(result.current.isLoading).toBe(false);

    act(() => {
      void qc.refetchQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ isLoading: false, isPending: false, isError: true, isFetching: true, error: boom });

    await act(async () => {
      release('ok');
    });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current).toMatchObject({ isLoading: false, isError: false, error: null });
  });

  it('query bị reset (xoá sạch trạng thái) → lần tải đầu lại: khung chờ hiện lại, không giữ lỗi cũ', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockImplementation(() => new Promise<string>(() => {}));
    const { result, qc } = setup(fn);
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => {
      void qc.resetQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ isLoading: true, isError: false, error: null });
  });

  it('có dữ liệu rồi làm mới lỗi: giữ dữ liệu cũ, isError=true (dữ liệu không bị bỏ)', async () => {
    const fn = vi.fn().mockResolvedValueOnce('cũ').mockRejectedValueOnce(new Error('boom'));
    const { result, qc } = setup(fn);
    await waitFor(() => expect(result.current.data).toBe('cũ'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBe('cũ');
    expect(result.current.isLoading).toBe(false);
  });
});
