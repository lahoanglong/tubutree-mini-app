import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CartBadge, CountBadge } from './cart-badge';

describe('CountBadge / CartBadge', () => {
  it('ẩn khi count <= 0', () => {
    const { container } = render(<CountBadge count={0} label="x" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('hiện số, 99+ khi quá 99, aria-label theo nhãn truyền vào', () => {
    const { rerender } = render(<CountBadge count={7} label="7 đơn đang xử lý" />);
    expect(screen.getByLabelText('7 đơn đang xử lý')).toHaveTextContent('7');
    rerender(<CountBadge count={120} label="nhiều" />);
    expect(screen.getByLabelText('nhiều')).toHaveTextContent('99+');
  });
  it('CartBadge giữ nhãn cũ "N sản phẩm trong giỏ" và dùng token DS v2 (không --clay-500/--neutral-0)', () => {
    render(<CartBadge count={2} />);
    const el = screen.getByLabelText('2 sản phẩm trong giỏ');
    expect(el.getAttribute('style')).toContain('var(--color-promo-solid-bg)');
    expect(el.getAttribute('style')).not.toMatch(/--clay-500|--neutral-0/);
  });
});
