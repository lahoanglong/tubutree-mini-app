import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { lazy } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteShell, SilentBoundary } from './route-shell';
import { vi as copy } from '../i18n/vi';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: React.ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/shop-api', () => ({ fetchSupportContact: vi.fn().mockResolvedValue({ hotline: '0900000000' }) }));

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/cart']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RouteShell (R-84, R-79)', () => {
  it('lỗi render của một màn: hiện lỗi có nút Thử lại, thử lại thì dựng lại màn', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    function Page() {
      if (broken) throw new Error('hỏng');
      return <p>Giỏ hàng đã lên</p>;
    }
    wrap(<RouteShell><Page /></RouteShell>);
    expect(screen.getByText(copy.errors.generic)).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: copy.common.retry }));
    expect(screen.getByText('Giỏ hàng đã lên')).toBeInTheDocument();
  });

  it('màn đang tải mã: khung chờ (không phải vòng quay), tải xong thì hiện màn', async () => {
    const Lazy = lazy(() => Promise.resolve({ default: () => <p>Xong</p> }));
    wrap(<RouteShell skeleton="grid"><Lazy /></RouteShell>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('Xong')).toBeInTheDocument();
  });

  it('Đổi rác đang tải mã: vẽ đúng khung trang (tiêu đề + 3 khối 140/80/80), không phải khung danh sách (R-54)', () => {
    const Never = lazy(() => new Promise<{ default: () => JSX.Element }>(() => undefined));
    const { container, unmount } = wrap(<RouteShell skeleton="recycle"><Never /></RouteShell>);
    expect(screen.getByRole('heading', { name: 'Đổi rác lấy quà' })).toBeInTheDocument();
    const heights = Array.from(container.querySelectorAll<HTMLElement>('[style*="height"]')).map((el) => el.style.height);
    expect(heights).toEqual(expect.arrayContaining(['140px', '80px', '80px']));
    unmount();
    const list = wrap(<RouteShell><Never /></RouteShell>);
    expect(screen.queryByRole('heading', { name: 'Đổi rác lấy quà' })).toBeNull();
    list.unmount();
  });

  it('lỗi tải mã màn (mạng yếu): Thử lại tải lại app vì React.lazy giữ lời hứa đã lỗi', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://x/assets/cart.js')));
    wrap(<RouteShell><Broken /></RouteShell>);
    return screen.findByRole('button', { name: copy.common.retry }).then((btn) => {
      fireEvent.click(btn);
      expect(reload).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });

  it('lỗi tải file CSS của màn (Vite: Unable to preload CSS) cũng tải lại app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const Broken = lazy(() => Promise.reject(new Error('Unable to preload CSS for /assets/dealer-abc.css')));
    wrap(<RouteShell><Broken /></RouteShell>);
    return screen.findByRole('button', { name: copy.common.retry }).then((btn) => {
      fireEvent.click(btn);
      expect(reload).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });
});

describe('SilentBoundary', () => {
  it('con lỗi (kể cả không tải được mã) thì không hiện gì, phần còn lại của app vẫn lên', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Bad(): never {
      throw new Error('chunk');
    }
    wrap(
      <>
        <p>Trang chủ</p>
        <SilentBoundary><Bad /></SilentBoundary>
      </>,
    );
    expect(screen.getByText('Trang chủ')).toBeInTheDocument();
  });
});
