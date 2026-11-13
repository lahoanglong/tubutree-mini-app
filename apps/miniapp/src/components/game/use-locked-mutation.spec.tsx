import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections } from '../../test-support/unhandled';
import { useLockedMutation } from './use-locked-mutation';

// Bản Mini App phải giữ cùng hành vi với `apps/web/src/components/game/use-locked-mutation.spec.tsx`.

const gate = () => {
  let open!: () => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    open = res;
    fail = rej;
  });
  return { promise, open, fail };
};
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function mountLocked(over: { onSettled?: () => unknown; mutationFn?: (id: string) => Promise<string> } = {}) {
  const run = vi.fn(over.mutationFn ?? (async (id: string) => id));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const h = renderHook(
    () => useLockedMutation({ mutationFn: run, onSettled: over.onSettled as never }, (id: string) => id),
    { wrapper },
  );
  const press = (id: string) =>
    act(async () => {
      h.result.current.mutate(id);
    });
  return { h, run, press };
}

describe('useLockedMutation (Mini App): nhả khoá', () => {
  it('cú gọi thứ hai cùng đích trong cùng khung hình bị bỏ qua; đích khác vẫn chạy', async () => {
    const { h, run } = mountLocked();
    await act(async () => {
      h.result.current.mutate('a');
      h.result.current.mutate('a');
      h.result.current.mutate('b');
    });
    await settle();
    expect(run.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
  });

  it('onSettled đồng bộ: khoá nhả ngay khi xong, gọi lại được', async () => {
    const { run, press } = mountLocked({ onSettled: () => undefined });
    await press('a');
    await settle();
    await press('a');
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lệnh lỗi: khoá nhả, gọi lại được', async () => {
    const { run, press } = mountLocked({ mutationFn: async () => Promise.reject(new Error('mạng')) });
    await press('a');
    await settle();
    await press('a');
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('onSettled trả Promise: khoá giữ tới khi nó xong, chạm đúp trong lúc tải lại không gửi lệnh thứ hai', async () => {
    const refresh = gate();
    const { run, press } = mountLocked({ onSettled: () => refresh.promise });
    await press('a');
    await settle();
    // Lệnh `a` đã xong nhưng "tải lại" còn chạy: `a` vẫn khoá, chạm lại bị bỏ qua.
    await press('a');
    await press('a');
    expect(run.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(1);
    refresh.open();
    await settle();
    await press('a');
    await settle();
    expect(run.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(2);
  });

  it('onSettled trả Promise: đích khác đổi `variables` của mutation thì khoá của `a` KHÔNG vì thế mà nhả', async () => {
    const refresh = gate();
    const { h, run, press } = mountLocked({ onSettled: () => refresh.promise });
    await press('a');
    await settle();
    await press('b');
    await settle();
    expect(h.result.current.variables).toBe('b');
    await press('a');
    expect(run.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(1);
    refresh.open();
    await settle();
    await press('a');
    await settle();
    expect(run.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(2);
  });

  it('onSettled ném lỗi đồng bộ: khoá vẫn nhả, lỗi không bị nuốt', async () => {
    const { run, press } = mountLocked({
      onSettled: () => {
        throw new Error('hỏng');
      },
    });
    const seen = await captureUnhandledRejections(async () => {
      await press('a');
      await settle();
      await press('a');
      await settle();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(seen.some((e) => (e as Error).message === 'hỏng')).toBe(true);
  });

  it('onSettled trả Promise bị từ chối: khoá giữ tới lúc đó rồi nhả, lỗi không bị nuốt', async () => {
    const refresh = gate();
    const { run, press } = mountLocked({ onSettled: () => refresh.promise });
    const seen = await captureUnhandledRejections(async () => {
      await press('a');
      await settle();
      await press('a');
      expect(run).toHaveBeenCalledTimes(1);
      refresh.fail(new Error('tải lại hỏng'));
      await settle();
      await press('a');
      await settle();
    });
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(seen.some((e) => (e as Error).message === 'tải lại hỏng')).toBe(true);
  });
});
