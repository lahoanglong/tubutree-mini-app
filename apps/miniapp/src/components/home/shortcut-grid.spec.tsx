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

describe('ShortcutGrid Mini App — 2 thẻ chính + 4 ô phụ + lối tắt nhanh (W177)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    mocks.openRequests = false;
  });

  it('dựng tĩnh đủ 6 lối vào: hàng 1 hai thẻ chính, hàng 2 bốn ô phụ, và điều hướng đúng route Mini App', () => {
    const { container } = render(<ShortcutGrid />);
    const hub = screen.getByTestId('ecosystem-bento-hub');
    const all = Array.from(hub.querySelectorAll<HTMLButtonElement>('button[data-pillar]'));
    expect(all).toHaveLength(6);
    expect(all.map((c) => [c.dataset.pillar, c.dataset.tier])).toEqual([
      ['retail', 'hero'],
      ['recycle', 'hero'],
      ['groupBuy', 'chip'],
      ['subscription', 'chip'],
      ['garden', 'chip'],
      ['rewards', 'chip'],
    ]);
    expect(all.map((c) => c.querySelector('[data-pillar-title]')?.textContent)).toEqual([
      'Mua lẻ · Giờ vàng',
      'Đổi rác — Miễn ship đơn sau',
      'Mua chung',
      'Mua xoay vòng',
      'Vườn Xanh',
      'Kho quà 0đ',
    ]);
    expect(container.querySelectorAll('.tubu-bento-card--hero')).toHaveLength(2);
    expect(container.querySelectorAll('.tubu-chip-row > .tubu-chip')).toHaveLength(4);
    // Ô phụ chỉ có biểu tượng và tên ngắn: không phụ đề, không nhãn nhỏ.
    for (const chip of Array.from(container.querySelectorAll('.tubu-chip'))) {
      expect(chip.querySelector('[data-pillar-sub], [data-pillar-tag]')).toBeNull();
    }

    const expectedRoutes = ['/flash-sale', '/recycle', '/group-buy', '/subscriptions', '/game', '/offers?tab=rewards'];
    all.forEach((card, idx) => {
      fireEvent.click(card);
      expect(mocks.navigate).toHaveBeenLastCalledWith(expectedRoutes[idx]);
    });
  });

  it('thẻ chính: nêu Điểm Xanh; ô phụ đọc đủ tên và phụ đề cho trình đọc màn hình', () => {
    const { container } = render(<ShortcutGrid />);
    expect(container.querySelector('[data-pillar="recycle"]')?.textContent).toContain('Nhận Điểm Xanh');
    expect(container.querySelector('[data-pillar="retail"]')?.textContent).toContain('Giờ vàng');
    expect(container.querySelector('[data-pillar="groupBuy"]')?.getAttribute('aria-label')).toBe('Mua chung. Rủ bạn đủ nhóm giảm sâu');
  });

  it('hàng lối tắt nhanh chỉ còn Mã giảm giá (/vouchers), Cộng đồng (/feed) và nút Thêm; Giờ vàng không lặp vì đã là thẻ chính', async () => {
    render(<ShortcutGrid />);
    const pills = screen.getByTestId('shortcut-quick-pills');
    expect(within(pills).queryByRole('button', { name: /Giờ vàng/ })).toBeNull();
    fireEvent.click(within(pills).getByRole('button', { name: /Mã giảm giá/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/vouchers');
    fireEvent.click(within(pills).getByRole('button', { name: /Cộng đồng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lối tắt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tất cả lối tắt' });
    expect(rows(dialog)).toHaveLength(9);
    fireEvent.click(within(dialog).getByRole('button', { name: /Giờ vàng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/flash-sale');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tất cả lối tắt' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lối tắt' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Tất cả lối tắt' })).getByRole('button', { name: /Đơn hàng/ }));
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

  it('Đổi rác tạm dừng mà khách còn yêu cầu đang mở: giữ đủ 6 ô, thẻ chính thứ hai đổi sang "Yêu cầu của tôi" và dẫn vào /recycle/requests', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.openRequests = true;
    const { container } = render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, true);
    const recycleCard = container.querySelector<HTMLButtonElement>('[data-pillar="recycle"]')!;
    expect(recycleCard.textContent).toContain('Yêu cầu của tôi');
    fireEvent.click(recycleCard);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/requests');
  });

  it('cấu hình đang chờ vẫn giữ nguyên 6 lối vào (2 thẻ chính + 4 ô phụ) và 3 nút lối tắt nhanh (CLS = 0)', () => {
    mocks.cfg = { isLoaded: false, isPending: true, waste: { enabled: false } };
    const { container } = render(<ShortcutGrid />);
    expect(container.querySelectorAll('[data-pillar]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-tier="hero"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-tier="chip"]')).toHaveLength(4);
    expect(screen.getByTestId('shortcut-quick-pills').querySelectorAll('button')).toHaveLength(3);
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
