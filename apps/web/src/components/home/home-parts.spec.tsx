// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
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

  it('đang tải lại thì khoá nút', () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError onRetry={onRetry} retrying />);
    expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });
});
