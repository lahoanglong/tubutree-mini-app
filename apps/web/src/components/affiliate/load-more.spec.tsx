// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { LoadMore } from './load-more';

// "Tải thêm" của lịch sử hoa hồng và lệnh chuyển Ví trang CTV (Mini ↔ web): chạm đúp cùng khung hình chỉ nạp một trang; nút bận báo bằng
// aria (không `disabled`, kẻo Chromium thả focus về body); lượt nạp lỗi nhả khoá và lỗi vẫn lên unhandledrejection như Button của Mini.

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
type Q = Parameters<typeof LoadMore>[0]['q'];
const query = (over: Partial<Q> = {}): Q => ({ hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: false, fetchNextPage: vi.fn(), ...over });

let mounted: Rendered | null = null;
const mount = (q: Q) => {
  mounted = render(<LoadMore q={q} />);
  return mounted;
};
const more = () => mounted!.container.querySelector('button')!;
const tapTogether = (el: HTMLElement) =>
  act(async () => {
    el.click();
    el.click();
  });
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('LoadMore (CTV): khoá chạm đúp', () => {
  it('hai cú chạm cùng khung hình chỉ nạp một trang; nút báo bận bằng aria, không disabled, giữ focus; xong thì bấm lại được', async () => {
    const page = gate<unknown>();
    const q = query({ fetchNextPage: vi.fn(() => page.promise) });
    mount(q);
    more().focus();
    await tapTogether(more());
    expect(q.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(more().getAttribute('aria-busy')).toBe('true');
    expect(more().getAttribute('aria-disabled')).toBe('true');
    expect(more().disabled).toBe(false);
    expect(document.activeElement).toBe(more());
    click(more());
    expect(q.fetchNextPage).toHaveBeenCalledTimes(1);
    page.resolve(undefined);
    await flush(3);
    expect(more().hasAttribute('aria-busy')).toBe(false);
    click(more());
    expect(q.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('đang nạp (isFetchingNextPage) mà chưa chạm: nút đã báo bận bằng aria, chạm không gọi thêm', async () => {
    const q = query({ isFetchingNextPage: true });
    mount(q);
    expect(more().textContent).toBe('Đang tải…');
    expect(more().getAttribute('aria-busy')).toBe('true');
    expect(more().disabled).toBe(false);
    click(more());
    expect(q.fetchNextPage).not.toHaveBeenCalled();
  });

  it('lượt nạp bị từ chối: nhả khoá để bấm lại, lỗi vẫn lên unhandledrejection (không bị nuốt)', async () => {
    const boom = new Error('mất mạng');
    const q = query({ fetchNextPage: vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(undefined) });
    mount(q);
    const unhandled = await captureUnhandledRejections(async () => {
      click(more());
      await flush(3);
    });
    expect(unhandled).toEqual([boom]);
    expect(more().hasAttribute('aria-busy')).toBe(false);
    click(more());
    expect(q.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('nạp lỗi trang kế: giữ nút và nói cách thử lại; hết trang thì không vẽ gì', () => {
    mount(query({ isFetchNextPageError: true }));
    expect(mounted!.container.textContent).toContain('Chưa tải thêm được. Bạn bấm Tải thêm để thử lại nhé.');
    mounted!.unmount();
    mount(query({ hasNextPage: false }));
    expect(mounted!.container.textContent).toBe('');
  });
});
