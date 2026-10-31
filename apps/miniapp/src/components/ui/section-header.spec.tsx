import { fireEvent, render, screen } from '@testing-library/react';
import { Truck } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SectionHeader } from './section-header';

beforeEach(() => vi.clearAllMocks());

describe('SectionHeader', () => {
  it('tiêu đề là h2 (đổi được sang h3), Inter 700, một dòng cắt "…"', () => {
    const { rerender } = render(<SectionHeader title="Bán chạy nhất" />);
    const h = screen.getByRole('heading', { level: 2, name: 'Bán chạy nhất' });
    expect(h.style.fontWeight).toBe('700');
    expect(h.style.letterSpacing).toBe('-0.01em');
    expect(h.style.textOverflow).toBe('ellipsis');
    expect(h.style.whiteSpace).toBe('nowrap');
    rerender(<SectionHeader title="Bán chạy nhất" as="h3" />);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('hàng cao đúng --section-header-h (44px chạm của nút xem tất cả)', () => {
    render(<SectionHeader title="Giờ vàng" id="flash-title" action={{ to: '/flash-sale' }} />);
    const row = screen.getByRole('heading', { name: 'Giờ vàng' }).closest('[data-testid="section-header"]') as HTMLElement;
    expect(row.style.minHeight).toBe('var(--section-header-h)');
    expect(screen.getByRole('heading', { name: 'Giờ vàng' })).toHaveAttribute('id', 'flash-title');
  });

  it('icon theo tên hoặc truyền thẳng LucideIcon, luôn aria-hidden', () => {
    const { container, rerender } = render(<SectionHeader title="A" icon="zap" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<SectionHeader title="A" icon={Truck} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<SectionHeader title="A" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('tone="promo": chữ màu --color-promo-fg', () => {
    render(<SectionHeader title="Giờ vàng" tone="promo" />);
    expect(screen.getByRole('heading', { name: 'Giờ vàng' }).style.color).toBe('var(--color-promo-fg)');
  });

  it('trailing hiện sau tiêu đề; subtitle là caption một dòng', () => {
    render(<SectionHeader title="Giờ vàng" trailing={<span data-testid="tr">12 mã</span>} subtitle="Theo lượt bán 30 ngày" />);
    expect(screen.getByTestId('tr')).toBeInTheDocument();
    const sub = screen.getByText('Theo lượt bán 30 ngày');
    expect(sub.style.whiteSpace).toBe('nowrap');
  });

  it('không action thì không nút; có action thì nút tên "Xem tất cả {title}", bấm điều hướng một lần', () => {
    const { rerender } = render(<SectionHeader title="Giờ vàng" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<SectionHeader title="Giờ vàng" action={{ to: '/flash-sale' }} />);
    const btn = screen.getByRole('button', { name: 'Xem tất cả Giờ vàng' });
    expect(btn).toHaveTextContent('Xem tất cả');
    fireEvent.click(btn);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/flash-sale');
  });

  it('action.label tuỳ chọn: chữ nhìn thấy nằm trong tên đọc', () => {
    render(<SectionHeader title="Mã giảm giá" action={{ label: 'Tất cả 12 mã', to: '/vouchers' }} />);
    const btn = screen.getByRole('button', { name: /Tất cả 12 mã/ });
    expect(btn).toHaveAccessibleName('Tất cả 12 mã Mã giảm giá');
  });

  it('tiêu đề dài bị cắt còn nút xem tất cả không bị đẩy ra ngoài', () => {
    render(<SectionHeader title="Một tiêu đề khối rất rất dài không thể nằm vừa một dòng trên khổ 375px" action={{ to: '/x' }} />);
    const btn = screen.getByRole('button');
    expect(btn.style.flex).toBe('0 0 auto');
    expect(btn.style.minHeight).toBe('44px');
  });
});
