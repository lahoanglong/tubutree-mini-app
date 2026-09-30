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

  it('guards double-tap internally: a press while loading=true is ignored WITHOUT the caller passing disabled', () => {
    const onPress = vi.fn();
    // Mô phỏng đúng vòng đời thật: bấm lần 1 lúc chưa loading (onPress chạy, thường sẽ set
    // loading=true ở caller) → rerender với loading=true (chưa kịp xong request) → bấm lần 2
    // trong lúc đó. Không truyền disabled — guard phải tự nằm trong Button.
    const { rerender } = render(<Button loading={false} onPress={onPress}>Lưu</Button>);
    fireEvent.click(screen.getByText('Lưu'));
    rerender(<Button loading onPress={onPress}>Lưu</Button>);
    fireEvent.click(screen.getByText('Lưu'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('loading=true still shows the spinner with disabled absent (re-confirm after the internal guard change)', () => {
    const { container } = render(<Button loading onPress={() => {}}>Đang xử lý</Button>);
    expect(container.querySelector('.zaui-btn')?.className).toContain('loading');
    expect(container.querySelector('.zaui-btn')?.getAttribute('disabled')).toBeNull();
  });

  // Final review I1 — jsdom không nạp CSS ZaUI (.zaui-btn-loading>*{visibility:hidden}) nên nhãn
  // chữ vẫn "thấy" được ở đây; vì vậy test khoá cả THUỘC TÍNH aria-label (thứ sống sót qua CSS thật,
  // e2e design-system-pilot kiểm trên Chromium) chứ không chỉ accessible name.
  describe('a11y while loading', () => {
    it('keeps the accessible name (derived from string children) and sets aria-busy/aria-disabled', () => {
      render(<Button loading onPress={() => {}}>Thêm vào giỏ</Button>);
      const btn = screen.getByRole('button', { name: 'Thêm vào giỏ' });
      expect(btn).toHaveAttribute('aria-label', 'Thêm vào giỏ');
      expect(btn).toHaveAttribute('aria-busy', 'true');
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).not.toHaveAttribute('disabled'); // vẫn không đẩy loading vào disabled (A4-07)
    });

    it('derives the name from mixed string/number children (e.g. "Đặt hàng · " + price)', () => {
      const price = '149.000đ';
      render(<Button loading>Đặt hàng · {price} {false}</Button>);
      expect(screen.getByRole('button', { name: 'Đặt hàng · 149.000đ' })).toHaveAttribute('aria-busy', 'true');
    });

    it('explicit aria-label wins (and is the only way to name JSX children while loading)', () => {
      render(
        <Button loading aria-label="Mua lại đơn hàng">
          <span>Mua lại</span>
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'Mua lại đơn hàng' })).toHaveAttribute('aria-busy', 'true');
    });

    it('not loading: no aria-busy, no forced aria-label, aria-disabled only when disabled', () => {
      const { rerender } = render(<Button>Lưu</Button>);
      const btn = screen.getByRole('button', { name: 'Lưu' });
      expect(btn).not.toHaveAttribute('aria-busy');
      expect(btn).not.toHaveAttribute('aria-label');
      expect(btn).not.toHaveAttribute('aria-disabled');
      rerender(<Button disabled>Lưu</Button>);
      expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('passes arbitrary aria-* props through to the real <button>', () => {
      render(<Button aria-describedby="hint-1" aria-expanded={false}>Mở</Button>);
      const btn = screen.getByRole('button', { name: 'Mở' });
      expect(btn).toHaveAttribute('aria-describedby', 'hint-1');
      expect(btn).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('size md is minHeight 44, lg is 48', () => {
    const { rerender, container } = render(<Button size="md">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('44px');
    rerender(<Button size="lg">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('48px');
  });
});
