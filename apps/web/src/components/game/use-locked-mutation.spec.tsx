// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { useLockedMutation } from './use-locked-mutation';

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

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

function mountLocked(over: { onSettled?: () => unknown; mutationFn?: (id: string) => Promise<string> } = {}) {
  const run = vi.fn(over.mutationFn ?? (async (id: string) => id));
  const h = renderHook(() =>
    useLockedMutation(
      { mutationFn: run, onSettled: over.onSettled as never },
      (id: string) => id,
    ),
  );
  unmount = h.unmount;
  const press = (id: string) =>
    act(async () => {
      h.result.current.mutate(id);
    });
  return { h, run, press };
}

describe('useLockedMutation: nhả khoá', () => {
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

  it('onSettled trả Promise: khoá giữ tới khi nó xong, kể cả khi đích khác đã đổi `variables` của mutation', async () => {
    const refresh = gate();
    const { h, run, press } = mountLocked({ onSettled: () => refresh.promise });
    await press('a');
    await settle();
    // Lệnh `a` đã xong nhưng "tải lại" còn chạy: `a` vẫn khoá.
    await press('a');
    expect(run.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(1);
    // Đích khác chạy làm `variables` đổi sang `b`: khoá của `a` KHÔNG vì thế mà nhả.
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

  it('onSettled ném lỗi đồng bộ: khoá vẫn nhả', async () => {
    const { run, press } = mountLocked({
      onSettled: () => {
        throw new Error('hỏng');
      },
    });
    // Lỗi của onSettled không bị nuốt: nó vẫn lên `unhandledrejection` (Sentry), chỉ khoá là phải nhả.
    const seen = await captureUnhandledRejections(async () => {
      await press('a');
      await settle();
      await press('a');
      await settle();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(seen.some((e) => (e as Error).message === 'hỏng')).toBe(true);
  });

  it('onSettled trả Promise bị từ chối: khoá giữ tới lúc đó rồi nhả', async () => {
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
