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
  it('sm=16, lg=24', () => {
    render(<Icon icon={Heart} size="sm" data-testid="sm" />);
    expect(screen.getByTestId('sm').getAttribute('width')).toBe('16');
    render(<Icon icon={Heart} size="lg" data-testid="lg" />);
    expect(screen.getByTestId('lg').getAttribute('width')).toBe('24');
  });
});
