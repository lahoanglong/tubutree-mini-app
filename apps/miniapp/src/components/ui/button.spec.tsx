import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders children and calls onPress on click', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Mua ngay</Button>);
    fireEvent.click(screen.getByText('Mua ngay'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('loading=true shows the ZaUI spinner (never sets zaui disabled=true from loading alone)', () => {
    const { container } = render(<Button loading>Đang xử lý</Button>);
    // ZaUI's zaui-btn-loading class is the real signal it will draw a spinner (loading && !disabled).
    expect(container.querySelector('.zaui-btn')?.className).toContain('loading');
    expect(container.querySelector('.zaui-btn')?.getAttribute('disabled')).toBeNull();
  });

  it('explicit disabled=true (not from loading) does disable the underlying button', () => {
    const onPress = vi.fn();
    render(<Button disabled onPress={onPress}>Hết hàng</Button>);
    fireEvent.click(screen.getByText('Hết hàng'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading=true AND explicit disabled=true both apply (button is disabled, spinner still requested) — onPress blocked either way', () => {
    const onPress = vi.fn();
    render(<Button loading disabled onPress={onPress}>X</Button>);
    fireEvent.click(screen.getByText('X'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('size md is minHeight 44, lg is 48', () => {
    const { rerender, container } = render(<Button size="md">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('44px');
    rerender(<Button size="lg">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('48px');
  });
});
