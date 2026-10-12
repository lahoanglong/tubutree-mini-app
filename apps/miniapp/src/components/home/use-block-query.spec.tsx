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

// `lastError` thuộc về từng lần mount của hook: một instance chỉ giữ trạng thái lỗi do chính nó đã thấy, và chỉ khi lỗi
// đó là của query đang quan sát. React Query v5 bỏ lỗi cũ khi tải lại (error=null) nên instance mới gắn vào giữa lúc
// tải lại không có cách nào biết lỗi là gì.
describe('useBlockQuery: trạng thái lỗi theo từng lần mount', () => {
  const never = () => new Promise<string>(() => {});
  const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('hai instance cùng query: instance gắn vào giữa lúc tải lại sau lỗi không giả làm "đã lỗi" mà không có lỗi; instance cũ giữ nguyên', async () => {
    const boom = new Error('boom');
    const fn = vi.fn().mockRejectedValueOnce(boom).mockImplementation(never);
    const qc = newClient();
    const first = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    act(() => {
      void qc.refetchQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));

    const second = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    expect(first.result.current).toMatchObject({ isError: true, isLoading: false, error: boom });
    // Không có lỗi nào để hiện: isError=true kèm error=undefined làm khối báo lỗi chung chung thay vì lỗi thật.
    expect(second.result.current.isError && second.result.current.error === undefined).toBe(false);
    expect(second.result.current).toMatchObject({ isLoading: true, isError: false });
  });

  it('unmount rồi mount lại giữa lúc tải lại: lần mount mới bắt đầu sạch (khung chờ), không mang theo lỗi của lần mount trước', async () => {
    const boom = new Error('boom');
    const fn = vi.fn().mockRejectedValueOnce(boom).mockImplementation(never);
    const qc = newClient();
    const first = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    await waitFor(() => expect(first.result.current.error).toBe(boom));
    act(() => {
      void qc.refetchQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    first.unmount();

    const again = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    expect(again.result.current.isError && again.result.current.error === undefined).toBe(false);
    expect(again.result.current).toMatchObject({ isLoading: true, isError: false });
  });

  it('lần mount mới tự thấy lỗi mới thì hiện đúng lỗi đó', async () => {
    const boom = new Error('boom');
    const next = new Error('lỗi lần hai');
    let fail: (e: Error) => void = () => {};
    const fn = vi.fn().mockRejectedValueOnce(boom).mockImplementationOnce(() => new Promise<string>((_r, rej) => { fail = rej; }));
    const qc = newClient();
    const first = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    act(() => {
      void qc.refetchQueries({ queryKey: ['k'] });
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    first.unmount();
    const again = renderHook(() => useBlockQuery(useQuery({ queryKey: ['k'], queryFn: fn })), { wrapper: wrap(qc) });
    await act(async () => {
      fail(next);
    });
    await waitFor(() => expect(again.result.current.isError).toBe(true));
    expect(again.result.current.error).toBe(next);
  });

  it('hai instance trên hai query khác nhau không lẫn lỗi của nhau', async () => {
    const ea = new Error('lỗi A');
    const eb = new Error('lỗi B');
    const qc = newClient();
    const a = renderHook(() => useBlockQuery(useQuery({ queryKey: ['a'], queryFn: () => Promise.reject(ea) })), { wrapper: wrap(qc) });
    const b = renderHook(() => useBlockQuery(useQuery({ queryKey: ['b'], queryFn: () => Promise.reject(eb) })), { wrapper: wrap(qc) });
    await waitFor(() => expect(a.result.current.isError && b.result.current.isError).toBe(true));
    expect(a.result.current.error).toBe(ea);
    expect(b.result.current.error).toBe(eb);
  });

  it('cùng một instance đổi sang query khác (đổi key) đang tải lại sau lỗi cũ của nó: không hiện lỗi của query trước', async () => {
    const ea = new Error('lỗi A');
    const eb = new Error('lỗi B');
    const qc = newClient();
    // Query B đã từng lỗi (errorUpdateCount > 0) rồi nằm trong cache; khi instance chuyển sang B thì nó tải lại.
    await qc.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.reject(eb) }).catch(() => undefined);
    const fns: Record<string, () => Promise<string>> = { a: () => Promise.reject(ea), b: never };
    const hook = renderHook(({ k }: { k: string }) => useBlockQuery(useQuery({ queryKey: [k], queryFn: fns[k]! })), {
      wrapper: wrap(qc),
      initialProps: { k: 'a' },
    });
    await waitFor(() => expect(hook.result.current.error).toBe(ea));
    hook.rerender({ k: 'b' });
    await waitFor(() => expect(hook.result.current.error).not.toBe(ea));
    expect(hook.result.current.isError && hook.result.current.error === undefined).toBe(false);
  });
});

