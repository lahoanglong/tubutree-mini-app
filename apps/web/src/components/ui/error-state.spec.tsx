// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { ErrorState } from './error-state';

vi.mock('@/lib/core-http', () => ({
  coreHttp: { get: async () => ({ support: { hotline: '18001234' } }) },
}));

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ErrorState', () => {
  it('chữ mặc định, role alert, nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    const { container } = mount(<ErrorState onRetry={onRetry} />);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Đã có lỗi xảy ra. Bạn thử lại nhé.');
    click(container.querySelector('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')!.textContent).toBe('Thử lại');
  });

  it('nút Thử lại dưới md: khi rê chuột nền sáng đổi sang sáng khác, không rơi về nền xanh đậm của btnPrimary (chữ xanh đậm mất hút)', () => {
    const { container } = mount(<ErrorState onRetry={() => {}} />);
    const cls = container.querySelector('button')!.className.split(/\s+/);
    expect(cls).toContain('max-md:text-forest-700');
    expect(cls).toContain('max-md:hover:bg-forest-100');
    expect(cls).not.toContain('max-md:border-forest-100');
  });

  it('không có onRetry thì không có nút; message tuỳ biến', () => {
    const { container } = mount(<ErrorState message="Không tải được đơn" />);
    expect(container.querySelector('[data-testid="error-message"]')?.textContent).toBe('Không tải được đơn');
    expect(container.querySelector('button')).toBeNull();
  });

  it('page: kèm hotline đọc từ cấu hình công khai; inline và showSupport={false} thì không', async () => {
    const { container } = mount(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorState message="x" />
        <ErrorState message="y" variant="inline" />
        <ErrorState message="z" showSupport={false} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const tels = container.querySelectorAll('a[href^="tel:"]');
    expect(tels).toHaveLength(1);
    expect(tels[0]!.getAttribute('href')).toBe('tel:18001234');
    expect(tels[0]!.textContent).toContain('1800 1234');
  });

  it('không có QueryClientProvider thì chỉ ẩn dòng hotline, màn lỗi vẫn hiện', () => {
    const { container } = mount(<ErrorState message="x" />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  describe('Thử lại khoá chạm đúp', () => {
    const gate = () => {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const tapTwice = async (b: HTMLElement) => {
      await act(async () => {
        b.click();
        b.click();
      });
    };

    it('onRetry trả Promise: hai cú chạm cùng khung hình chỉ gọi một lần; nút báo bận bằng aria, không disabled; xong thì bấm lại được', async () => {
      const g = gate();
      const onRetry = vi.fn(() => g.promise);
      const { container } = mount(<ErrorState onRetry={onRetry} />);
      const b = container.querySelector('button')!;
      await tapTwice(b);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(b.getAttribute('aria-busy')).toBe('true');
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
      await act(async () => {
        g.resolve();
        await g.promise;
      });
      expect(b.getAttribute('aria-busy')).toBeNull();
      expect(b.getAttribute('aria-disabled')).toBeNull();
      click(b);
      await flush(1);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('Promise bị từ chối: nhả khoá để bấm lại được và ném lại đúng lỗi (không nuốt)', async () => {
      const g = gate();
      const onRetry = vi.fn().mockReturnValueOnce(g.promise).mockReturnValue(undefined);
      const { container } = mount(<ErrorState onRetry={onRetry} />);
      const b = container.querySelector('button')!;
      const boom = new Error('mất mạng');
      const seen = await captureUnhandledRejections(async () => {
        await tapTwice(b);
        await act(async () => {
          g.reject(boom);
          await g.promise.catch(() => undefined);
        });
      });
      expect(seen).toEqual([boom]);
      expect(b.getAttribute('aria-busy')).toBeNull();
      click(b);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('onRetry ném đồng bộ: không để khoá kẹt, lần bấm sau vẫn gọi được', () => {
      let n = 0;
      const onRetry = vi.fn(() => {
        n += 1;
        if (n === 1) throw new Error('ném đồng bộ');
      });
      const { container } = mount(<ErrorState onRetry={onRetry} />);
      const b = container.querySelector('button')!;
      // React đưa lỗi ném trong handler lên `window.error`; chặn mặc định để vitest không tính nó là lỗi chưa bắt.
      const swallow = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', swallow);
      try {
        click(b);
        click(b);
      } finally {
        window.removeEventListener('error', swallow);
      }
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('nút "Về trang chủ" không bao giờ báo bận', async () => {
      const onHome = vi.fn();
      const { container } = mount(<ErrorState onHome={onHome} />);
      const b = container.querySelector('button')!;
      await tapTwice(b);
      expect(onHome).toHaveBeenCalledTimes(2);
      expect(b.getAttribute('aria-busy')).toBeNull();
    });
  });
});
