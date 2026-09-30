import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StorePageShell } from './store-page-shell';

describe('StorePageShell', () => {
  it('renders cover, avatar fallback, title, badges, and children', () => {
    render(
      <StorePageShell coverHeight={84} avatarSize={58} avatarFallback={<span>S</span>} title="Gian hàng Xanh" badges={<span>CTV</span>}>
        <div>Lưới sản phẩm</div>
      </StorePageShell>,
    );
    expect(screen.getByText('Gian hàng Xanh')).toBeInTheDocument();
    expect(screen.getByText('CTV')).toBeInTheDocument();
    expect(screen.getByText('Lưới sản phẩm')).toBeInTheDocument();
  });
  it('renders stickyBar in a StickyActionBar when given', () => {
    render(<StorePageShell coverHeight={84} avatarSize={58} avatarFallback={<span>S</span>} title="x" stickyBar={<button>Chia sẻ</button>}>{null}</StorePageShell>);
    expect(screen.getByText('Chia sẻ')).toBeInTheDocument();
  });
});
