import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/', count: 0, dot: null as null | 'check-in' | 'coupon-expiring' }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname, search: '', state: null }),
}));
vi.mock('../hooks/use-active-order-count', () => ({ useActiveOrderCount: (enabled: boolean) => (enabled ? mocks.count : 0) }));
vi.mock('../hooks/use-offers-dot', () => ({ useOffersDot: (enabled: boolean) => (enabled ? mocks.dot : null) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BottomNav from './bottom-nav';
import { GARDEN_HINT_DELAY_MS } from './garden-hint-bubble';

const settle = () =>
  act(() => {
    vi.advanceTimersByTime(GARDEN_HINT_DELAY_MS + 10);
  });

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    mocks.count = 0;
    mocks.dot = null;
    localStorage.clear();
  });

  it('5 tab trong <nav>, có "Ưu đãi", không còn "Đơn hàng" và "Ví & HH"', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(nav).toHaveTextContent('Ưu đãi');
    expect(nav).not.toHaveTextContent('Đơn hàng');
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

  it('badge số đơn đang xử lý nằm trên tab Cá nhân + nhãn a11y', () => {
    mocks.count = 2;
    render(<BottomNav />);
    const tab = screen.getByRole('button', { name: 'Cá nhân, 2 đơn đang xử lý' });
    expect(tab).toHaveTextContent('2');
  });

  it('chấm đỏ tab Ưu đãi chỉ hiện khi có việc (chưa điểm danh / mã sắp hết hạn)', () => {
    const none = render(<BottomNav />);
    expect(screen.queryByTestId('offers-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ưu đãi' })).toBeInTheDocument();
    none.unmount();
    mocks.dot = 'check-in';
    render(<BottomNav />);
    expect(screen.getByTestId('offers-dot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ưu đãi, có việc cần làm' })).toBeInTheDocument();
  });

  it('bấm tab khác → navigate; tab đang mở có aria-current=page', () => {
    mocks.pathname = '/offers';
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: 'Ưu đãi' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Cá nhân' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile');
  });

  it('ẩn ở trang con (vd /orders và /wallet đã thành trang con)', () => {
    mocks.pathname = '/orders';
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it('không còn biến CSS cũ --neutral/--leaf/--primary', () => {
    const { container } = render(<BottomNav />);
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary)-/);
  });

  describe('bóng gợi ý Vườn Xanh', () => {
    const HINT = 'Trồng cây mỗi ngày, nhận quà thật';
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('lần mở đầu hiện, bấm vào bóng thì mở Vườn Xanh và tắt; mở lại app không hiện nữa', () => {
      const first = render(<BottomNav />);
      settle();
      fireEvent.click(screen.getByText(HINT));
      expect(mocks.navigate).toHaveBeenCalledWith('/game');
      expect(screen.queryByText(HINT)).toBeNull();
      first.unmount();
      render(<BottomNav />);
      settle();
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('đã hiện một lần thì không hiện lại dù khách chưa bấm đóng', () => {
      const first = render(<BottomNav />);
      settle();
      expect(screen.getByText(HINT)).toBeInTheDocument();
      first.unmount();
      render(<BottomNav />);
      settle();
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('mở tab Vườn Xanh thì bóng tắt', () => {
      const { rerender } = render(<BottomNav />);
      settle();
      expect(screen.getByText(HINT)).toBeInTheDocument();
      mocks.pathname = '/game';
      rerender(<BottomNav />);
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('không hiện ở trang con, và không hiện khi mở thẳng tab Vườn Xanh', () => {
      mocks.pathname = '/game';
      render(<BottomNav />);
      expect(screen.queryByText(HINT)).toBeNull();
      expect(localStorage.getItem('tubu_garden_hint_seen')).toBe('1');
    });

    it('storage ném lỗi thì không hiện và không vỡ nav', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      render(<BottomNav />);
      expect(screen.queryByText(HINT)).toBeNull();
      expect(screen.getAllByRole('button')).toHaveLength(5);
      spy.mockRestore();
    });
  });
});
