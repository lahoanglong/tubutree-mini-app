import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

describe('StickyActionBar', () => {
  it('applies safe-area padding exactly once and is fixed to the bottom', () => {
    render(<StickyActionBar primary={<button>Mua ngay</button>} />);
    const bar = screen.getByText('Mua ngay').closest('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.style.position).toBe('fixed');
    expect(bar.style.paddingBottom).toBe('calc(16px + var(--safe-bottom))');
  });
  it('renders optional summary above the buttons', () => {
    render(<StickyActionBar primary={<button>x</button>} summary={<span>Tổng 100.000đ</span>} />);
    expect(screen.getByText('Tổng 100.000đ')).toBeInTheDocument();
  });
  it('đánh dấu khung cuộn .zaui-page để chừa chỗ cho thanh, gỡ khi tháo', () => {
    const { unmount } = render(
      <div className="zaui-page" data-testid="pg">
        <StickyActionBar primary={<button>x</button>} />
      </div>,
    );
    expect(screen.getByTestId('pg')).toHaveClass('tubu-scroll-pad-sticky-bar');
    unmount();
  });
  it('gỡ lớp khỏi khung khi thanh tháo ra', () => {
    const host = document.createElement('div');
    host.className = 'zaui-page';
    document.body.appendChild(host);
    const { unmount } = render(<StickyActionBar primary={<button>x</button>} />, { container: host.appendChild(document.createElement('div')) });
    expect(host).toHaveClass('tubu-scroll-pad-sticky-bar');
    unmount();
    expect(host).not.toHaveClass('tubu-scroll-pad-sticky-bar');
    host.remove();
  });
});

describe('StickyActionBar: lead, dense, chiều cao', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('`lead` nằm CÙNG HÀNG với nút chính, bên trái; nút giữ bề rộng riêng', () => {
    render(<StickyActionBar primary={<button>Thanh toán</button>} lead={<span>Tạm tính 100.000đ</span>} />);
    const row = screen.getByText('Thanh toán').parentElement!.parentElement as HTMLElement;
    expect(row).toContainElement(screen.getByText('Tạm tính 100.000đ'));
    expect(screen.getByText('Tạm tính 100.000đ').parentElement!.nextElementSibling).toBe(screen.getByText('Thanh toán').parentElement);
    expect((screen.getByText('Thanh toán').parentElement as HTMLElement).style.flex).toContain('0 0 auto');
  });

  it('không có `lead` thì nút chiếm cả hàng như mọi trang khác', () => {
    render(<StickyActionBar primary={<button>Mua ngay</button>} />);
    expect((screen.getByText('Mua ngay').parentElement as HTMLElement).style.flex).toBe('1 1 0%');
  });

  it('`dense` đệm 10px (safe-area vẫn cộng một lần), không `dense` giữ 16px', () => {
    const { unmount } = render(<StickyActionBar dense primary={<button>x</button>} />);
    const bar = screen.getByTestId('sticky-bar');
    expect(bar.style.paddingBottom).toBe('calc(10px + var(--safe-bottom))');
    expect(bar.style.gap).toBe('4px');
    unmount();
    render(<StickyActionBar primary={<button>y</button>} />);
    expect(screen.getByTestId('sticky-bar').style.gap).toBe('8px');
  });

  it('ghi chiều cao thật vào --sticky-bar-h khi gắn, cập nhật khi thanh đổi cao, gỡ khi tháo', () => {
    let notify: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} });
    let height = 140.2;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect);
    const { unmount } = render(<StickyActionBar primary={<button>x</button>} />);
    expect(document.documentElement.style.getPropertyValue('--sticky-bar-h')).toBe('141px');
    height = 190;
    notify();
    expect(document.documentElement.style.getPropertyValue('--sticky-bar-h')).toBe('190px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--sticky-bar-h')).toBe('');
    rect.mockRestore();
  });
});
