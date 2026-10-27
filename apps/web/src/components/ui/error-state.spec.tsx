// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Đã có lỗi xảy ra — Vui lòng thử lại');
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
});
