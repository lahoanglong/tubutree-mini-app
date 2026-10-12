import { act, render, screen, fireEvent } from '@testing-library/react';
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

    it('caller-provided aria-busy / aria-disabled win over the loading-derived defaults (followups: aria order)', () => {
      render(<Button loading aria-busy={false} aria-disabled={false}>Lưu</Button>);
      const btn = screen.getByRole('button', { name: 'Lưu' });
      expect(btn).toHaveAttribute('aria-busy', 'false');
      expect(btn).toHaveAttribute('aria-disabled', 'false');
    });
  });

  // C-070 — `loading` chỉ có hiệu lực sau khi caller re-render; hai cú bấm đồng bộ (cùng tick,
  // trước khi React kịp cập nhật prop) vẫn lọt qua. Khoá phải nằm trong ref của Button.
  describe('khoá bấm đúp đồng bộ khi onPress trả Promise (C-070)', () => {
    it('hai cú bấm liên tiếp trước khi loading render: onPress async chỉ chạy 1 lần', async () => {
      let resolve!: () => void;
      const onPress = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
      render(<Button onPress={onPress}>Đặt hàng</Button>);
      const btn = screen.getByText('Đặt hàng');
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(onPress).toHaveBeenCalledTimes(1);
      await act(async () => { resolve(); });
    });

    it('khi Promise xong thì nhả khoá: bấm lại được', async () => {
      const onPress = vi.fn(() => Promise.resolve());
      render(<Button onPress={onPress}>Lưu</Button>);
      fireEvent.click(screen.getByText('Lưu'));
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(screen.getByText('Lưu'));
      expect(onPress).toHaveBeenCalledTimes(2);
    });

    it('Promise reject cũng nhả khoá (không kẹt nút vĩnh viễn)', async () => {
      // Dùng thenable giả để test không sinh unhandledrejection thật (vitest coi đó là lỗi chạy test).
      let reject!: (e: unknown) => void;
      const onPress = vi.fn(() => ({
        then: (_ok: () => void, fail: (e: unknown) => void) => { reject = (e) => { try { fail(e); } catch { /* Button ném lại lỗi cho nơi báo lỗi toàn cục */ } }; },
      }) as unknown as Promise<void>);
      render(<Button onPress={onPress}>Gửi</Button>);
      fireEvent.click(screen.getByText('Gửi'));
      fireEvent.click(screen.getByText('Gửi'));
      expect(onPress).toHaveBeenCalledTimes(1);
      await act(async () => { reject(new Error('mạng lỗi')); });
      fireEvent.click(screen.getByText('Gửi'));
      expect(onPress).toHaveBeenCalledTimes(2);
    });

    it('lỗi của Promise vẫn tới nơi báo lỗi toàn cục (Button không nuốt lỗi)', async () => {
      let rethrown: unknown;
      const onPress = vi.fn(() => ({
        then: (_ok: () => void, fail: (e: unknown) => void) => { try { fail(new Error('mạng lỗi')); } catch (e) { rethrown = e; } },
      }) as unknown as Promise<void>);
      render(<Button onPress={onPress}>Gửi</Button>);
      fireEvent.click(screen.getByText('Gửi'));
      expect((rethrown as Error).message).toBe('mạng lỗi');
    });

    it('onPress đồng bộ (không trả Promise) KHÔNG bị khoá: nút +/- bấm nhanh vẫn gọi đủ', () => {
      const onPress = vi.fn();
      render(<Button onPress={onPress}>+</Button>);
      fireEvent.click(screen.getByText('+'));
      fireEvent.click(screen.getByText('+'));
      expect(onPress).toHaveBeenCalledTimes(2);
    });
  });

  it('size md is minHeight 44, lg is 48', () => {
    const { rerender, container } = render(<Button size="md">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('44px');
    rerender(<Button size="lg">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('48px');
  });
});
