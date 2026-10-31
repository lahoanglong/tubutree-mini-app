import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  openRequests: false,
  recycleHook: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../hooks/use-recycle-open-requests', () => ({
  useRecycleOpenRequests: (authed: boolean, paused: boolean) => {
    mocks.recycleHook(authed, paused);
    return mocks.openRequests;
  },
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('./earn-sheet', () => ({ EarnSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Kiếm tiền cùng Tubu" /> : null) }));

import { ShortcutGrid } from './shortcut-grid';

const rows = (dialog: HTMLElement) => within(dialog).getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Đóng');

describe('ShortcutGrid — 4 ô cố định + "Tất cả" (Q7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    mocks.openRequests = false;
  });

  it('cờ bật hết: 4 ô cố định (Mã giảm giá, Đổi rác, Mua chung, Đổi quà) và ô "Tất cả", không cuộn ngang; chưa có trang Giờ vàng nên chưa có ô Giờ vàng', () => {
    render(<ShortcutGrid />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Mã giảm giá', 'Đổi rác', 'Mua chung', 'Đổi quà', 'Tất cả']);
    expect(screen.queryByRole('button', { name: /Giờ vàng/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Lối tắt' }).querySelector('[data-testid="shortcut-grid"]')).toHaveStyle({ display: 'grid' });
    expect(screen.queryByRole('group', { name: /vuốt ngang/ })).toBeNull();
  });

  it('nhãn tối đa hai dòng, cao cố định 32px, không nowrap: "Mã giảm giá" xuống dòng chứ không bị cắt "…"; ô vẫn cao 84px', () => {
    render(<ShortcutGrid />);
    for (const b of screen.getAllByRole('button')) {
      expect(b).toHaveStyle({ height: '84px' });
      const label = b.lastElementChild as HTMLElement;
      expect(label).toHaveStyle({ height: '32px', lineHeight: '16px', overflow: 'hidden' });
      expect(label.style.whiteSpace).not.toBe('nowrap');
      expect(label.style.textOverflow).toBe('');
      expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    }
  });

  it('Mã giảm giá tới mã của tôi, Đổi rác, Mua chung, Đổi quà tới đúng trang', () => {
    render(<ShortcutGrid />);
    fireEvent.click(screen.getByRole('button', { name: /Mã giảm giá/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?section=coupons');
    fireEvent.click(screen.getByRole('button', { name: /Đổi rác/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    fireEvent.click(screen.getByRole('button', { name: /Mua chung/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/group-buy');
    fireEvent.click(screen.getByRole('button', { name: /Đổi quà/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/rewards');
  });

  it('"Tất cả" mở hộp thoại liệt kê đủ mục còn hiển thị; chọn mục đóng hộp và điều hướng', async () => {
    render(<ShortcutGrid />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả lối tắt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tất cả lối tắt' });
    expect(rows(dialog)).toHaveLength(8);
    fireEvent.click(within(dialog).getByRole('button', { name: /Đơn hàng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tất cả lối tắt' })).toBeNull());
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', async () => {
    render(<ShortcutGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả lối tắt' }));
    mocks.navigate.mockClear();
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Tất cả lối tắt' })).getByRole('button', { name: /Kiếm tiền cùng Tubu/ }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Kiếm tiền cùng Tubu' })).toBeInTheDocument();
  });

  it('cờ Đổi rác và Tích điểm đơn sàn tắt: ô trống được Đổi quà lấp, vẫn đủ 4 ô + "Tất cả"; hộp thoại còn 6 mục', async () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    render(<ShortcutGrid />);
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Mã giảm giá', 'Mua chung', 'Đổi quà', 'Đơn hàng', 'Tất cả']);
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả lối tắt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tất cả lối tắt' });
    expect(rows(dialog)).toHaveLength(6);
    expect(within(dialog).queryByRole('button', { name: /Đổi rác/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /sàn khác/ })).toBeNull();
  });

  it('cấu hình chưa về: không hiện mục có cờ (đóng khi chưa biết)', () => {
    mocks.cfg = { isLoaded: false, waste: { enabled: false } };
    render(<ShortcutGrid />);
    expect(screen.queryByRole('button', { name: /Đổi rác/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('Đổi rác tạm dừng mà khách còn yêu cầu đang mở: vẫn hiện ở ô cố định, ghi "Yêu cầu" và dẫn vào Đổi rác', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.openRequests = true;
    render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, true);
    expect(screen.queryByRole('button', { name: /^Đổi rác/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Yêu cầu của tôi/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    expect(screen.getByText('Yêu cầu')).toBeInTheDocument();
  });

  it('chương trình đang chạy: không cần hỏi yêu cầu đang mở', () => {
    render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, false);
  });

  it('tên đọc của mỗi ô chứa chữ đang hiển thị (WCAG 2.5.3); nhãn một dòng, vùng chạm ≥44px', () => {
    render(<ShortcutGrid />);
    for (const button of screen.getAllByRole('button')) {
      const visible = button.textContent?.trim().toLowerCase() ?? '';
      expect(button.getAttribute('aria-label')?.toLowerCase()).toContain(visible);
      expect(button).toHaveStyle({ minHeight: '44px' });
    }
  });
});
