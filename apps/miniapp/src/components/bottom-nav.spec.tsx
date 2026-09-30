import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/', count: 0 }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname, search: '', state: null }),
}));
vi.mock('../hooks/use-active-order-count', () => ({ useActiveOrderCount: (enabled: boolean) => (enabled ? mocks.count : 0) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BottomNav from './bottom-nav';

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    mocks.count = 0;
  });

  it('5 tab trong <nav>, có "Đơn hàng", không còn "Ví & HH"', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(nav).toHaveTextContent('Đơn hàng');
    expect(nav).not.toHaveTextContent('Ví & HH');
    expect(nav).toHaveStyle({ height: 'calc(60px + var(--safe-bottom))' });
  });

  it('mỗi tab tự đảm bảo vùng bấm cao ≥44px (đo từng tab, không chỉ thanh nav)', () => {
    render(<BottomNav />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      // jsdom không có layout → đo minHeight khai báo trên chính tab; thiếu khai báo → NaN → so sánh thất bại.
      const min = Number.parseFloat(getComputedStyle(b).minHeight);
      expect(min, `tab "${b.getAttribute('aria-label')}" thiếu minHeight`).toBeGreaterThanOrEqual(44);
    }
  });

  it('badge số đơn đang xử lý trên tab Đơn hàng + nhãn a11y', () => {
    mocks.count = 2;
    render(<BottomNav />);
    const tab = screen.getByRole('button', { name: 'Đơn hàng, 2 đơn đang xử lý' });
    expect(tab).toHaveTextContent('2');
  });

  it('bấm tab khác → navigate; tab đang mở có aria-current=page', () => {
    mocks.pathname = '/orders';
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: 'Đơn hàng' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Cá nhân' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile');
  });

  it('ẩn ở trang con (vd /wallet đã thành trang con)', () => {
    mocks.pathname = '/wallet';
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it('không còn biến CSS cũ --neutral/--leaf/--primary', () => {
    const { container } = render(<BottomNav />);
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary)-/);
  });
});
