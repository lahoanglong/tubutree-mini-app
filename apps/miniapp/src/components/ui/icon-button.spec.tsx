import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { X } from 'lucide-react';
import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('renders with aria-label from the required label prop', () => {
    render(<IconButton icon={X} label="Đóng" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });
  it('hit area is 44x44 for size=md (default) even though the visible circle is smaller', () => {
    render(<IconButton icon={X} label="Đóng" />);
    const btn = screen.getByRole('button', { name: 'Đóng' });
    expect(btn.style.minWidth).toBe('44px');
    expect(btn.style.minHeight).toBe('44px');
  });
  it('calls onPress on click', () => {
    const onPress = vi.fn();
    render(<IconButton icon={X} label="Đóng" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('shows a badge dot when badge=true', () => {
    render(<IconButton icon={X} label="Thông báo" badge />);
    expect(screen.getByTestId('icon-button-badge')).toBeInTheDocument();
  });
});
