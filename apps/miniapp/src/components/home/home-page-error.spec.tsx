import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HomePageError } from './home-page-error';

function renderStrip(props: Partial<React.ComponentProps<typeof HomePageError>> = {}) {
  const onRetry = props.onRetry ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HomePageError error={new Error('x')} onRetry={onRetry} {...props} />
    </QueryClientProvider>,
  );
  return { onRetry };
}
const retryButton = () => screen.getByRole('button', { name: 'Thử lại' });

describe('HomePageError: Thử lại khoá chạm đúp (W70A)', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp trong cùng một khung hình chỉ tải lại một lần; xong thì chạm lại được', async () => {
    const d = deferred();
    const onRetry = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    renderStrip({ onRetry });
    await act(async () => {
      fireEvent.click(retryButton());
      fireEvent.click(retryButton());
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    await act(async () => {
      fireEvent.click(retryButton());
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('tải lại lỗi: khoá nhả nên chạm lại gọi tiếp, không treo nút', async () => {
    const d = deferred();
    const onRetry = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    renderStrip({ onRetry });
    await act(async () => {
      fireEvent.click(retryButton());
    });
    await act(async () => {
      d.reject(new Error('offline'));
      await d.promise.catch(() => undefined);
    });
    await act(async () => {
      fireEvent.click(retryButton());
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('onRetry không trả Promise: khoá nhả ngay sau đó, không kẹt nút', async () => {
    const onRetry = vi.fn();
    renderStrip({ onRetry });
    await act(async () => {
      fireEvent.click(retryButton());
    });
    await act(async () => {
      fireEvent.click(retryButton());
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('đang tải lại (retrying): nút báo aria-busy và không nhận lần chạm', () => {
    const onRetry = vi.fn();
    renderStrip({ onRetry, retrying: true });
    expect(retryButton()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(retryButton());
    expect(onRetry).not.toHaveBeenCalled();
  });
});
