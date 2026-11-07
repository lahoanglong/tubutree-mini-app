import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FreeShippingProgressBar } from './free-shipping-progress-bar';

describe('FreeShippingProgressBar (Mini)', () => {
  it('chưa đạt: dòng "Mua thêm {số còn thiếu} để được Miễn phí giao hàng", thanh progressbar đúng mức và tên truy cập', () => {
    render(<FreeShippingProgressBar base={50_000} threshold={200_000} />);
    const block = screen.getByTestId('freeship-progress');
    expect(block).toHaveAttribute('data-reached', 'false');
    expect(within(block).getByText('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toBe(screen.getByTestId('freeship-bar'));
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAccessibleName('Đã đạt 25% để được Miễn phí giao hàng');
    expect(screen.getByTestId('freeship-fill')).toHaveStyle({ width: '25%' });
  });

  it('chưa đạt nhưng gần đủ: thanh tối đa 99%, không đầy khi còn thiếu vài đồng', () => {
    render(<FreeShippingProgressBar base={199_999} threshold={200_000} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
    expect(screen.getByText(/Mua thêm 1đ/)).toBeInTheDocument();
  });

  it('tubuOnly: câu nói rõ chỉ tính phần hàng Tubu Tree giao', () => {
    render(<FreeShippingProgressBar base={50_000} threshold={200_000} tubuOnly />);
    expect(screen.getByText('Mua thêm 150.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao 🚚')).toBeInTheDocument();
  });

  it('đạt ngưỡng: dòng chúc mừng, không còn thanh, data-reached=true', () => {
    render(<FreeShippingProgressBar base={200_000} threshold={200_000} />);
    expect(screen.getByTestId('freeship-progress')).toHaveAttribute('data-reached', 'true');
    expect(screen.getByText('🎉 Đơn hàng đã được Miễn phí giao hàng')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId('freeship-bar')).toBeNull();
    expect(screen.queryByTestId('freeship-fill')).toBeNull();
  });

  it('đạt ngưỡng + tubuOnly: câu chúc mừng riêng của phần Tubu giao', () => {
    render(<FreeShippingProgressBar base={250_000} threshold={200_000} tubuOnly />);
    expect(screen.getByText('🎉 Phần hàng Tubu Tree giao đã được Miễn phí giao hàng')).toBeInTheDocument();
  });

  it('serverReached thắng số tính ở máy: đạt dù base chưa tới ngưỡng', () => {
    render(<FreeShippingProgressBar base={10_000} threshold={200_000} serverReached />);
    expect(screen.getByTestId('freeship-progress')).toHaveAttribute('data-reached', 'true');
    expect(screen.queryByTestId('freeship-bar')).toBeNull();
  });

  it('ngưỡng 0 (mọi đơn đều được miễn phí): đạt ngay', () => {
    render(<FreeShippingProgressBar base={0} threshold={0} />);
    expect(screen.getByTestId('freeship-progress')).toHaveAttribute('data-reached', 'true');
  });

  it('chữ trạng thái là vùng status để trình đọc màn hình nghe khi chuyển từ chưa đạt sang đạt', () => {
    const { rerender } = render(<FreeShippingProgressBar base={100_000} threshold={200_000} />);
    expect(screen.getByRole('status')).toHaveTextContent('Mua thêm 100.000đ');
    rerender(<FreeShippingProgressBar base={200_000} threshold={200_000} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đơn hàng đã được Miễn phí giao hàng');
  });

  it('không có chữ cấm "Freeship" và không dấu chấm than trong chữ khách đọc', () => {
    const { container, rerender } = render(<FreeShippingProgressBar base={0} threshold={200_000} />);
    expect(container.textContent).not.toMatch(/freeship/i);
    expect(container.textContent).not.toContain('!');
    rerender(<FreeShippingProgressBar base={300_000} threshold={200_000} />);
    expect(container.textContent).not.toMatch(/freeship/i);
    expect(container.textContent).not.toContain('!');
  });

  it('chỉ token trong thuộc tính style: không số đo px, không màu thô (phần đầy chỉ đặt bề rộng %)', () => {
    const { container } = render(<FreeShippingProgressBar base={50_000} threshold={200_000} />);
    expect(container.querySelectorAll('[style*="px"]').length).toBe(0);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(screen.getByTestId('freeship-fill').getAttribute('style')).toBe('width: 25%;');
  });
});

describe('css/freeship.css: thanh Miễn phí giao hàng', () => {
  const css = readFileSync(resolve(__dirname, '../../css/freeship.css'), 'utf8');
  function loadSheet() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style.sheet!;
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const styleRules = () => Array.from(loadSheet().cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
  const rule = (sel: string) => styleRules().find((r) => r.selectorText === sel)!;

  it('số đều cho số tiền còn thiếu, rãnh --color-track, dải màu progress-fill-from → action-primary', () => {
    expect(rule('.tubu-freeship').style.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
    expect(rule('.tubu-freeship-track').style.getPropertyValue('background')).toBe('var(--color-track)');
    const fill = rule('.tubu-freeship-fill').style.getPropertyValue('background');
    expect(fill).toContain('linear-gradient(90deg');
    expect(fill).toContain('var(--color-progress-fill-from)');
    expect(fill).toContain('var(--color-action-primary-bg)');
  });

  it('phần đầy đầy dần bằng transition bề rộng (không đổi bố cục xung quanh)', () => {
    expect(rule('.tubu-freeship-fill').style.getPropertyValue('transition')).toContain('width');
  });

  it('khối giữ chiều cao tối thiểu của trạng thái chưa đạt; trạng thái đạt xanh ngọc theo token success', () => {
    expect(rule('.tubu-freeship').style.getPropertyValue('min-height')).toBe('56px');
    expect(rule(".tubu-freeship[data-reached='true']").style.getPropertyValue('background')).toBe('var(--color-status-success-bg)');
    expect(rule(".tubu-freeship[data-reached='true'] .tubu-freeship-text").style.getPropertyValue('color')).toBe('var(--color-text-success)');
  });

  it('shimmer chạy trên phần đã đầy và TẮT khi prefers-reduced-motion: reduce', () => {
    expect(rule('.tubu-freeship-fill::after').style.getPropertyValue('animation')).toContain('tubu-freeship-shimmer');
    const media = Array.from(loadSheet().cssRules).filter((r) => r.constructor.name === 'CSSMediaRule' && /prefers-reduced-motion:\s*reduce/.test((r as CSSMediaRule).conditionText ?? (r as CSSMediaRule).media.mediaText));
    expect(media.length).toBeGreaterThan(0);
    const inner = Array.from((media[0] as CSSMediaRule).cssRules) as CSSStyleRule[];
    const off = inner.find((r) => r.selectorText === '.tubu-freeship-fill::after')!;
    expect(off.style.getPropertyValue('animation')).toBe('none');
    expect(off.style.getPropertyValue('display')).toBe('none');
    expect(inner.find((r) => r.selectorText === '.tubu-freeship-fill')!.style.getPropertyValue('transition')).toBe('none');
  });
});
