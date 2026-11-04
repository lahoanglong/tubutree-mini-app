// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ report: vi.fn(), reload: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ reportError: mocks.report, reportErrorSettled: async (e: unknown) => mocks.report(e) }));

import ErrorPage from './error';

let mounted: Rendered | null = null;
beforeEach(() => {
  sessionStorage.clear();
  mocks.report.mockReset();
  mocks.reload.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: mocks.reload } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  mounted?.unmount();
  mounted = null;
});

const chunkErr = Object.assign(new Error('Loading chunk 6710 failed.'), { name: 'ChunkLoadError' });

describe('app/error.tsx', () => {
  it('lỗi thường: báo lỗi, nút "Thử lại" gọi reset', async () => {
    const reset = vi.fn();
    mounted = render(<ErrorPage error={new Error('x')} reset={reset} />);
    await flush();
    expect(mocks.report).toHaveBeenCalled();
    click(mounted.container.querySelector('button')!);
    expect(reset).toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('lỗi chunk lần đầu: tải lại một lần, không vẽ khối lỗi', async () => {
    mounted = render(<ErrorPage error={chunkErr} reset={vi.fn()} />);
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(mounted.container.innerHTML).toBe('');
  });
  it('lỗi chunk sau khi đã tải lại: hiện "Tải lại trang", bấm là tải lại chứ không reset', async () => {
    sessionStorage.setItem('tubu_chunk_reload_at', String(Date.now()));
    const reset = vi.fn();
    mounted = render(<ErrorPage error={chunkErr} reset={reset} />);
    await flush();
    expect(mocks.reload).not.toHaveBeenCalled();
    const btn = mounted.container.querySelector('button')!;
    expect(btn.textContent).toBe('Tải lại trang');
    click(btn);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
