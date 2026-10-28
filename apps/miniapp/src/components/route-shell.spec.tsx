import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { lazy } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteShell } from './route-shell';
import { vi as copy } from '../i18n/vi';

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
});
