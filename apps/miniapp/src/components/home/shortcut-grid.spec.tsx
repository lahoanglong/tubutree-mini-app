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

describe('ShortcutGrid Mini App — Bento Hub 6 trụ cột + lối tắt nhanh (W171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    mocks.openRequests = false;
  });

  it('dựng tĩnh đủ 6 trụ cột hệ sinh thái và điều hướng đúng route Mini App', () => {
    const { container } = render(<ShortcutGrid />);
    const hub = screen.getByTestId('ecosystem-bento-hub');
    const cards = Array.from(hub.querySelectorAll<HTMLButtonElement>('button[data-pillar]'));
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.querySelector('[data-pillar-title]')?.textContent)).toEqual([
      'Vườn Xanh & Game',
      'Đổi rác lấy quà',
      'Kho quà 0đ',
      'Mua chung giá kho',
      'Mua xoay vòng',
      'Đại lý & Tiếp thị liên kết',
    ]);
    expect(container.querySelector('[data-pillar="recycle"]')?.textContent).toContain('Miễn ship khi gửi kèm đơn');

    const expectedRoutes = ['/game', '/recycle', '/offers?tab=rewards', '/group-buy', '/subscriptions', '/affiliate'];
    cards.forEach((card, idx) => {
      fireEvent.click(card);
      expect(mocks.navigate).toHaveBeenLastCalledWith(expectedRoutes[idx]);
    });
  });

  it('hàng lối tắt nhanh đi thẳng Giờ vàng (/flash-sale), Mã giảm giá (/vouchers), Cộng đồng (/feed) và nút Thêm mở hộp thoại', async () => {
    render(<ShortcutGrid />);
    const pills = screen.getByTestId('shortcut-quick-pills');
    fireEvent.click(within(pills).getByRole('button', { name: /Giờ vàng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/flash-sale');
    fireEvent.click(within(pills).getByRole('button', { name: /Mã giảm giá/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/vouchers');
    fireEvent.click(within(pills).getByRole('button', { name: /Cộng đồng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lối tắt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tất cả lối tắt' });
    expect(rows(dialog)).toHaveLength(9);
    fireEvent.click(within(dialog).getByRole('button', { name: /Đơn hàng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tất cả lối tắt' })).toBeNull());
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', async () => {
    render(<ShortcutGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lối tắt' }));
    mocks.navigate.mockClear();
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Tất cả lối tắt' })).getByRole('button', { name: /Kiếm tiền cùng Tubu/ }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Kiếm tiền cùng Tubu' })).toBeInTheDocument();
  });

  it('Đổi rác tạm dừng mà khách còn yêu cầu đang mở: giữ đủ 6 ô, thẻ thứ hai đổi sang "Yêu cầu của tôi" và dẫn vào /recycle/requests', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.openRequests = true;
    const { container } = render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, true);
    const recycleCard = container.querySelector<HTMLButtonElement>('[data-pillar="recycle"]')!;
    expect(recycleCard.textContent).toContain('Yêu cầu của tôi');
    fireEvent.click(recycleCard);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/requests');
  });

  it('cấu hình đang chờ vẫn giữ nguyên 6 trụ cột và 4 nút lối tắt nhanh (CLS = 0)', () => {
    mocks.cfg = { isLoaded: false, isPending: true, waste: { enabled: false } };
    const { container } = render(<ShortcutGrid />);
    expect(container.querySelectorAll('[data-pillar]')).toHaveLength(6);
    expect(screen.getByTestId('shortcut-quick-pills').querySelectorAll('button')).toHaveLength(4);
  });

  it('chương trình đang chạy: không cần hỏi yêu cầu đang mở; tên đọc của nút có aria-label chứa chữ hiển thị (WCAG 2.5.3)', () => {
    render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, false);
    for (const button of screen.getAllByRole('button')) {
      const aria = button.getAttribute('aria-label');
      if (!aria) continue;
      const visible = button.textContent?.trim().toLowerCase() ?? '';
      expect(aria.toLowerCase()).toContain(visible);
    }
  });
});
