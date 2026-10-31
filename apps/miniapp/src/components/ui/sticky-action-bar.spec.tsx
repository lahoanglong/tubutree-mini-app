import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
