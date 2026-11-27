import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: '/',
  count: 0,
  dot: null as null | 'check-in' | 'coupon-expiring',
  reminders: { garden: false, profile: false, checkInElsewhere: false },
  offersArgs: [] as [boolean, boolean | undefined][],
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname, search: '', state: null }),
}));
vi.mock('../hooks/use-active-order-count', () => ({ useActiveOrderCount: (enabled: boolean) => (enabled ? mocks.count : 0) }));
vi.mock('../hooks/use-offers-dot', () => ({
  useOffersDot: (enabled: boolean, checkInElsewhere?: boolean) => {
    mocks.offersArgs.push([enabled, checkInElsewhere]);
    return enabled ? mocks.dot : null;
  },
}));
vi.mock('../hooks/use-engagement-dots', () => ({
  useEngagementDots: (enabled: boolean) => (enabled ? mocks.reminders : { garden: false, profile: false, checkInElsewhere: false }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BottomNav from './bottom-nav';

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    mocks.count = 0;
    mocks.dot = null;
    mocks.reminders = { garden: false, profile: false, checkInElsewhere: false };
    mocks.offersArgs = [];
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

  it('tab đang chọn không chỉ khác màu (WCAG 1.4.1): icon tô 16% + nảy; nhãn 12px nét 600, tab thường nét 500', () => {
    mocks.pathname = '/offers';
    render(<BottomNav />);
    const active = screen.getByRole('button', { name: 'Ưu đãi' });
    const idle = screen.getByRole('button', { name: 'Cá nhân' });
    expect(active.querySelector('svg')!.getAttribute('fill-opacity')).toBe('0.16');
    expect(active.querySelector('.tubu-tab-pop')).not.toBeNull();
    expect(idle.querySelector('svg')!.getAttribute('fill-opacity')).toBeNull();
    expect(idle.querySelector('.tubu-tab-pop')).toBeNull();
    const label = (el: HTMLElement, text: string) => within(el).getByText(text);
    expect(label(active, 'Ưu đãi').style.fontSize).toBe('var(--type-label-size)');
    expect(label(active, 'Ưu đãi').style.fontWeight).toBe('600');
    expect(label(idle, 'Cá nhân').style.fontWeight).toBe('500');
  });

  it('tab giữa cùng đường chân chữ với các tab khác: căn giữa như các tab khác, ô trống 24px không co thay chỗ icon', () => {
    render(<BottomNav />);
    const center = screen.getByRole('button', { name: 'Quét mã' });
    expect(center.style.justifyContent).toBe('center');
    expect(center.style.paddingBottom).toBe('0px');
    const spacer = center.firstElementChild as HTMLElement;
    expect(spacer.textContent).toBe('');
    expect(spacer.style.height).toBe('24px');
    expect(spacer.style.flexShrink).toBe('0');
  });

  it('mép trên là --elevation-nav, không còn borderTop chồng bóng cũ', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(nav.style.boxShadow).toBe('var(--elevation-nav)');
    expect(nav.style.borderTop).toBe('');
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

  it('W46: chấm Ưu đãi cùng một chấm 8px với Cá nhân (lớp tubu-remind-dot), không còn chấm 10px vẽ tay', () => {
    mocks.dot = 'check-in';
    render(<BottomNav />);
    const dot = screen.getByTestId('offers-dot');
    expect(dot).toHaveClass('tubu-remind-dot');
    expect(dot.getAttribute('style')).toBeNull();
  });

  it('chấm nhắc: tắt thì không có; bật thì chấm 8px ở Cá nhân kèm nhãn đọc, không nhấp nháy; chấm Vườn Xanh nằm ở thẻ Trang chủ, không ở thanh đáy (W42)', () => {
    const none = render(<BottomNav />);
    expect(screen.queryByTestId('profile-dot')).toBeNull();
    none.unmount();
    mocks.reminders = { garden: true, profile: true, checkInElsewhere: true };
    render(<BottomNav />);
    expect(screen.queryByTestId('garden-dot')).toBeNull();
    expect(screen.getByTestId('profile-dot')).toHaveClass('tubu-remind-dot');
    const rule = /\.tubu-remind-dot\s*\{([^}]*)\}/.exec(readFileSync(join(__dirname, '../css/tokens.css'), 'utf8'))![1]!;
    expect(rule).toMatch(/width:\s*8px;[\s\S]*height:\s*8px;/);
    expect(rule).not.toMatch(/animation|transition/);
    expect(screen.getByRole('button', { name: 'Quét mã' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cá nhân, có thông báo chưa đọc' })).toBeInTheDocument();
  });

  it('lý do "chưa điểm danh" của chấm Ưu đãi chỉ nhường cho thẻ Vườn Xanh ở Trang chủ; tab gốc khác giữ lý do đó (W42)', () => {
    mocks.reminders = { garden: true, profile: false, checkInElsewhere: true };
    const home = render(<BottomNav />);
    expect(mocks.offersArgs.at(-1)).toEqual([true, true]);
    home.unmount();
    for (const p of ['/browse', '/points/scan', '/offers', '/profile']) {
      mocks.pathname = p;
      const r = render(<BottomNav />);
      expect(mocks.offersArgs.at(-1), p).toEqual([true, false]);
      r.unmount();
    }
  });

  it('tab Cá nhân đang mang số đơn thì số thắng, không thêm chấm', () => {
    mocks.count = 2;
    mocks.reminders = { garden: false, profile: false, checkInElsewhere: true };
    render(<BottomNav />);
    expect(screen.queryByTestId('profile-dot')).toBeNull();
  });

  it('W46: mỗi tab tối đa một dấu: có số đơn thì chấm nhắc Cá nhân không vẽ kể cả khi hook nhắc còn bật (số và chấm không chồng trên một biểu tượng)', () => {
    mocks.count = 2;
    mocks.reminders = { garden: false, profile: true, checkInElsewhere: false };
    render(<BottomNav />);
    const tab = screen.getByRole('button', { name: 'Cá nhân, 2 đơn đang xử lý' });
    expect(screen.queryByTestId('profile-dot')).toBeNull();
    expect(tab).toHaveTextContent('2');
  });

  it('bấm tab khác → navigate; tab đang mở có aria-current=page', () => {
    mocks.pathname = '/offers';
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: 'Ưu đãi' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Cá nhân' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile', { replace: true });
  });

  describe('bấm lại tab đang mở', () => {
    afterEach(() => {
      document.querySelectorAll('.zaui-page').forEach((el) => el.remove());
      vi.restoreAllMocks();
    });
    const page = () => {
      const el = document.createElement('div');
      el.className = 'zaui-page';
      el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;
      document.body.appendChild(el);
      return el;
    };

    it('cuộn mượt về đầu trang đang mở (vùng cuộn là .zaui-page), không điều hướng', () => {
      mocks.pathname = '/offers';
      const el = page();
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Ưu đãi' }));
      expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('nhiều lớp trang trong DOM (đang chuyển cảnh): cuộn lớp trên cùng, lớp cũ không bị động', () => {
      mocks.pathname = '/';
      const old = page();
      const current = page();
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Trang chủ' }));
      expect(current.scrollTo).toHaveBeenCalledTimes(1);
      expect(old.scrollTo).not.toHaveBeenCalled();
    });

    it('không thấy .zaui-page thì cuộn cửa sổ; khách bật giảm chuyển động thì không cuộn mượt', () => {
      mocks.pathname = '/';
      const win = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Trang chủ' }));
      expect(win).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      vi.unstubAllGlobals();
    });
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

  describe('tab giữa Quét mã (W42)', () => {
    it('bấm Quét mã mở màn tích điểm đơn sàn; đang ở đó thì tab giữa là trang hiện tại', () => {
      const first = render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/points/scan', { replace: true });
      first.unmount();
      mocks.pathname = '/points/scan';
      render(<BottomNav />);
      expect(screen.getByRole('button', { name: 'Quét mã' })).toHaveAttribute('aria-current', 'page');
    });

    it('Vườn Xanh không còn là tab: /game là trang con, thanh đáy ẩn', () => {
      expect(screen.queryByRole('button', { name: 'Vườn Xanh' })).toBeNull();
      mocks.pathname = '/game';
      const { container } = render(<BottomNav />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
