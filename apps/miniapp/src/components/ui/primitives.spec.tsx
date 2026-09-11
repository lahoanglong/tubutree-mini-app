import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, Btn, Card, Chip, StickyActionBar, Txt } from './primitives';

describe('Btn', () => {
  it('loading → tự disable (chặn double-tap gửi 2 lần)', () => {
    const onClick = vi.fn();
    render(
      <Btn loading onClick={onClick}>
        Đặt hàng
      </Btn>,
    );
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('mọi cỡ đều đạt vùng chạm tối thiểu (≥36px, mặc định 44px)', () => {
    const { rerender, container } = render(<Btn size="small">A</Btn>);
    const h = () => (container.querySelector('button') as HTMLElement).style.minHeight;
    expect(parseInt(h(), 10)).toBeGreaterThanOrEqual(36);
    rerender(<Btn>B</Btn>);
    expect(parseInt(h(), 10)).toBe(44);
    rerender(<Btn size="large">C</Btn>);
    expect(parseInt(h(), 10)).toBe(48);
  });

  it('primary/danger dùng nền đặc, secondary/ghost thì không', () => {
    const { container, rerender } = render(<Btn variant="primary">A</Btn>);
    const bg = () => (container.querySelector('button') as HTMLElement).style.background;
    expect(bg()).toContain('--primary-600');
    rerender(<Btn variant="danger">A</Btn>);
    expect(bg()).toContain('--danger');
    rerender(<Btn variant="ghost">A</Btn>);
    expect(bg()).toBe('transparent');
  });
});

describe('Txt — tone theo Ý NGHĨA', () => {
  it('muted và subtle là 2 mức khác nhau (không lẫn lộn chữ phụ với chữ mờ)', () => {
    const { container: a } = render(<Txt tone="muted">x</Txt>);
    const { container: b } = render(<Txt tone="subtle">x</Txt>);
    const colorOf = (c: HTMLElement) => (c.firstElementChild as HTMLElement).style.color;
    expect(colorOf(a)).not.toBe(colorOf(b));
    expect(colorOf(a)).toContain('--neutral-600');
    expect(colorOf(b)).toContain('--neutral-400');
  });

  it('tone mặc định là chữ chính', () => {
    const { container } = render(<Txt>x</Txt>);
    expect((container.firstElementChild as HTMLElement).style.color).toContain('--neutral-900');
  });
});

describe('Card', () => {
  it('có onClick → là vùng bấm được (role=button) + có phản hồi chạm', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>nội dung</Card>);
    const el = screen.getByRole('button');
    expect(el.className).toContain('tubu-press');
  });

  it('không có onClick → KHÔNG gắn role=button (không đánh lừa trình đọc màn hình)', () => {
    render(<Card>nội dung</Card>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Badge / Chip', () => {
  it('mỗi tone có cặp nền/chữ riêng, không trùng nhau', () => {
    const { container: ok } = render(<Badge tone="success">Đã giao</Badge>);
    const { container: bad } = render(<Badge tone="danger">Đã hủy</Badge>);
    const bg = (c: HTMLElement) => (c.firstElementChild as HTMLElement).style.background;
    expect(bg(ok)).not.toBe(bg(bad));
  });

  it('Chip báo trạng thái chọn cho trình đọc màn hình (aria-pressed)', () => {
    render(<Chip selected>Cho mẹ & bé</Chip>);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('StickyActionBar', () => {
  it('luôn chừa safe-area đáy (nút không bị thanh home của máy che)', () => {
    const { container } = render(
      <StickyActionBar>
        <Btn>Mua ngay</Btn>
      </StickyActionBar>,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.style.paddingBottom).toContain('--safe-bottom');
    expect(bar.style.position).toBe('fixed');
  });
});
