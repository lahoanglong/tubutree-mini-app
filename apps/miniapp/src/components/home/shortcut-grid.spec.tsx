import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('./earn-sheet', () => ({ EarnSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Kiếm tiền cùng Tubu" /> : null) }));

import { ShortcutGrid } from './shortcut-grid';

describe('ShortcutGrid — 8 lối tắt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
  });

  it('cờ bật hết: đủ 8 lối tắt', () => {
    render(<ShortcutGrid />);
    expect(screen.getAllByRole('button')).toHaveLength(8);
  });

  it('cờ Đổi rác và Tích điểm đơn sàn tắt: bỏ 2 mục, hàng dồn lại còn 6', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    render(<ShortcutGrid />);
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /Đổi rác/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /sàn khác/ })).toBeNull();
  });

  it('cấu hình chưa về: không hiện mục có cờ (đóng khi chưa biết)', () => {
    mocks.cfg = { isLoaded: false, waste: { enabled: false } };
    render(<ShortcutGrid />);
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('mỗi lối tắt dẫn đúng trang; "Kiếm tiền" mở bảng chọn thay vì điều hướng', () => {
    render(<ShortcutGrid />);
    fireEvent.click(screen.getByRole('button', { name: /Đổi quà/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/rewards');
    fireEvent.click(screen.getByRole('button', { name: /Mã giảm giá của tôi/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?section=coupons');
    fireEvent.click(screen.getByRole('button', { name: /Đổi rác/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    mocks.navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Kiếm tiền cùng Tubu/ }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Kiếm tiền cùng Tubu' })).toBeInTheDocument();
  });
});
