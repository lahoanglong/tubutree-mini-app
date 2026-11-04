// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ report: vi.fn(), reload: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ reportError: mocks.report, reportErrorSettled: async (e: unknown) => mocks.report(e) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/support-hotline', () => ({ SupportHotline: () => null }));

import RootError from '@/app/error';
import GlobalError from '@/app/global-error';
import { SegmentError } from '@/components/segment-error';
import { CHUNK_OFFLINE_TEXT, CHUNK_UPDATED_TEXT, REACHABILITY_TIMEOUT_MS } from './use-chunk-recovery';

type Props = { error: Error & { digest?: string }; reset: () => void };
const boundaries: [string, ComponentType<Props>][] = [
  ['app/error', RootError],
  ['SegmentError', (p) => <SegmentError {...p} message="Lỗi riêng" />],
  ['global-error', GlobalError],
];

const chunkErr = Object.assign(new Error('Loading chunk 6710 failed.'), { name: 'ChunkLoadError' });
const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value: v });

const fetchMock = vi.fn();
let mounted: Rendered | null = null;
beforeEach(() => {
  sessionStorage.clear();
  mocks.report.mockReset();
  mocks.reload.mockReset();
  mocks.refresh.mockReset();
  setOnline(true);
  fetchMock.mockReset().mockResolvedValue({ status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: mocks.reload } });
  // global-error vẽ <html> trong khung thử: React cảnh báo lồng DOM, không liên quan tới điều cần kiểm.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(boundaries)('%s — lỗi chunk', (_name, Boundary) => {
  it('còn mạng, lần đầu: báo lỗi rồi tải lại một lần, không vẽ khối lỗi', async () => {
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await flush();
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report.mock.invocationCallOrder[0]!).toBeLessThan(mocks.reload.mock.invocationCallOrder[0]!);
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('còn mạng nhưng vừa tải lại mà vẫn lỗi: câu "vừa được cập nhật" và nút "Tải lại trang" (không reset, không refresh)', async () => {
    sessionStorage.setItem('tubu_chunk_reload_at', String(Date.now()));
    const reset = vi.fn();
    mounted = render(<Boundary error={chunkErr} reset={reset} />);
    await flush();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(CHUNK_UPDATED_TEXT);
    const btn = mounted.container.querySelector('button')!;
    expect(btn.textContent).toBe('Tải lại trang');
    click(btn);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('mất mạng: không tự tải lại, không báo lỗi, câu "Mất kết nối" và nút "Tải lại trang"; không nói "vừa được cập nhật"', async () => {
    setOnline(false);
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await flush();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_chunk_reload_at')).toBeNull();
    expect(mounted.container.textContent).toContain(CHUNK_OFFLINE_TEXT);
    expect(mounted.container.textContent).not.toContain('vừa được cập nhật');
    expect(mounted.container.querySelector('button')!.textContent).toBe('Tải lại trang');
  });
});

describe.each(boundaries)('%s — lỗi thường', (_name, Boundary) => {
  it('báo lỗi, không tải lại, nút "Thử lại" gọi reset', async () => {
    const reset = vi.fn();
    mounted = render(<Boundary error={new Error('x')} reset={reset} />);
    await flush();
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.reload).not.toHaveBeenCalled();
    const btn = mounted.container.querySelector('button')!;
    expect(btn.textContent).toBe('Thử lại');
    click(btn);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe.each(boundaries)('%s — mạng báo online nhưng không ra Internet', (_name, Boundary) => {
  const expectOffline = () => {
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_chunk_reload_at')).toBeNull();
    expect(mounted!.container.textContent).toContain(CHUNK_OFFLINE_TEXT);
    expect(mounted!.container.querySelector('button')!.textContent).toBe('Tải lại trang');
  };

  it('dò máy chủ lỗi mạng: coi như mất kết nối, không tải lại, không ghi khoá', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/', expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
    expectOffline();
  });

  it.each([502, 503, 500])('dò máy chủ trả %i (proxy đang đổi container lúc triển khai): không tải lại, không ghi khoá, hiện thông báo', async (status) => {
    fetchMock.mockResolvedValue({ status });
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await flush();
    expectOffline();
  });

  it('dò máy chủ trả 404 hay 304 (ứng dụng còn sống): vẫn tải lại', async () => {
    fetchMock.mockResolvedValue({ status: 404 });
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
  });

  it('dò máy chủ treo quá hạn: coi như mất kết nối', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))));
    mounted = render(<Boundary error={chunkErr} reset={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REACHABILITY_TIMEOUT_MS + 10);
    });
    expectOffline();
  });
});
