// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa home-parts.spec của Mini App (khối lỗi, dải lỗi cấp trang).
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { HomeBlockError, HomeBlockErrorSuppressed } from './home-block-error';
import { HomePageError } from './home-page-error';

let mounted: Rendered | null = null;
const mount = (ui: React.ReactElement) => (mounted = render(ui));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeBlockError', () => {
  it('tiêu đề + thông báo + nút "Thử lại", không mất khối im lặng (C-084)', () => {
    const refetch = vi.fn();
    const { container } = mount(<HomeBlockError title="Bán chạy" error={new ApiError('Máy chủ đang bận', 503)} onRetry={refetch} />);
    expect(container.querySelector('section[aria-label="Bán chạy"]')).not.toBeNull();
    expect(container.textContent).toContain('Máy chủ đang bận');
    click(container.querySelector('button[aria-label="Thử lại Bán chạy"]'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('đang thử lại sau lỗi → nút báo đang tải và khoá bấm tiếp', () => {
    const refetch = vi.fn();
    const { container } = mount(<HomeBlockError title="Bán chạy" error={new Error('x')} onRetry={refetch} retrying />);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Thử lại Bán chạy"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('lỗi không có thông báo cụ thể → câu chung giống ErrorBoundary', () => {
    const { container } = mount(<HomeBlockError title="Bán chạy" onRetry={() => undefined} />);
    expect(container.textContent).toContain('Đã có lỗi xảy ra');
  });

  it('trang đã có dải lỗi cấp trang (HomeBlockErrorSuppressed) → khối lỗi từng kệ ẩn, không xếp chồng', () => {
    const { container } = mount(
      <HomeBlockErrorSuppressed.Provider value>
        <HomeBlockError title="Bán chạy" error={new Error('x')} onRetry={() => undefined} />
        <HomeBlockError title="Mua lại" onRetry={() => undefined} />
      </HomeBlockErrorSuppressed.Provider>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('HomePageError', () => {
  it('một thẻ có tiêu đề, thông báo lỗi thật và nút "Thử lại" (D7 mục 5)', () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError error={new ApiError('Máy chủ đang bận', 503)} onRetry={onRetry} />);
    expect(container.querySelector('section[aria-label="Chưa tải được Trang chủ"]')).not.toBeNull();
    expect(container.textContent).toContain('Máy chủ đang bận');
    click(byText(container, 'button', 'Thử lại'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đang tải lại: nút báo aria-busy + aria-disabled, KHÔNG disabled (nút giữ focus), và không nhận lần chạm', () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError onRetry={onRetry} retrying />);
    const retry = container.querySelector<HTMLButtonElement>('button')!;
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.disabled).toBe(false);
    retry.focus();
    expect(document.activeElement).toBe(retry);
    click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('không tải lại thì nút không mang aria-busy / aria-disabled', () => {
    const { container } = mount(<HomePageError onRetry={() => undefined} />);
    const retry = container.querySelector<HTMLButtonElement>('button')!;
    expect(retry.hasAttribute('aria-busy')).toBe(false);
    expect(retry.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('HomePageError: Thử lại khoá chạm đúp (W70B, Mini ↔ web)', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const retryButton = (c: HTMLElement) => byText(c, 'button', 'Thử lại')!;
  const tap = async (el: HTMLElement, times = 1) => {
    await act(async () => {
      for (let i = 0; i < times; i++) el.click();
    });
  };

  it('chạm đúp trong cùng một khung hình chỉ tải lại một lần; xong thì chạm lại được', async () => {
    const d = deferred();
    const onRetry = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    const { container } = mount(<HomePageError onRetry={onRetry} />);
    await tap(retryButton(container), 2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    await tap(retryButton(container));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('tải lại lỗi (Promise bị từ chối): khoá nhả nên chạm lại gọi tiếp, không treo nút, lỗi vẫn lên unhandledrejection', async () => {
    const d = deferred();
    const onRetry = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    const { container } = mount(<HomePageError onRetry={onRetry} />);
    const reported = await captureUnhandledRejections(async () => {
      await tap(retryButton(container));
      await act(async () => {
        d.reject(new Error('offline'));
        await d.promise.catch(() => undefined);
      });
    });
    expect(reported.map((e) => (e as Error).message)).toEqual(['offline']);
    await tap(retryButton(container));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('onRetry không trả Promise: khoá nhả ngay sau đó, không kẹt nút', async () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError onRetry={onRetry} />);
    await tap(retryButton(container));
    await tap(retryButton(container));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('onRetry ném lỗi đồng bộ: khoá nhả, nút không chết', async () => {
    const onRetry = vi.fn().mockImplementationOnce(() => {
      throw new Error('sync');
    });
    const reported: string[] = [];
    const swallow = (e: ErrorEvent) => {
      reported.push(e.message);
      e.preventDefault();
    };
    window.addEventListener('error', swallow);
    try {
      const { container } = mount(<HomePageError onRetry={onRetry} />);
      await tap(retryButton(container), 2);
      expect(onRetry).toHaveBeenCalledTimes(2);
      // Lỗi vẫn lên tới trình duyệt (không bị nuốt), chỉ khoá là được nhả.
      expect(reported.some((m) => m.includes('sync'))).toBe(true);
    } finally {
      window.removeEventListener('error', swallow);
    }
  });
});
