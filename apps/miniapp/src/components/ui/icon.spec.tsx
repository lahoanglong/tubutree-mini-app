import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Heart } from 'lucide-react';
import { Icon } from './icon';

describe('Icon', () => {
  it('renders the given lucide icon at strokeWidth 1.75 and size md=20 by default', () => {
    render(<Icon icon={Heart} data-testid="i" />);
    const svg = screen.getByTestId('i');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });
  it('tone="current" ăn màu chữ của phần tử cha (icon trong huy hiệu/tiêu đề có màu riêng)', () => {
    render(<Icon icon={Heart} tone="current" data-testid="c" />);
    expect(screen.getByTestId('c').getAttribute('stroke')).toBe('currentColor');
  });
  it('sm=16, lg=24', () => {
    render(<Icon icon={Heart} size="sm" data-testid="sm" />);
    expect(screen.getByTestId('sm').getAttribute('width')).toBe('16');
    render(<Icon icon={Heart} size="lg" data-testid="lg" />);
    expect(screen.getByTestId('lg').getAttribute('width')).toBe('24');
  });
  it('filled: tô đặc nhẹ 16% cùng màu nét của tông (không theo màu chữ cha) và nét 2 (tab đang chọn của thanh dưới)', () => {
    render(<Icon icon={Heart} tone="brand" filled data-testid="f" />);
    const svg = screen.getByTestId('f');
    expect(svg.getAttribute('fill')).toBe('var(--color-text-brand)');
    expect(svg.getAttribute('stroke')).toBe('var(--color-text-brand)');
    expect(svg.getAttribute('fill-opacity')).toBe('0.16');
    expect(svg.getAttribute('stroke-width')).toBe('2');
  });
  it('không filled: rỗng như cũ (fill none, nét 1,75)', () => {
    render(<Icon icon={Heart} data-testid="n" />);
    const svg = screen.getByTestId('n');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
  });
});
