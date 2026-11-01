import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlashSoldBar } from './flash-sold-bar';

const fill = () => screen.queryByTestId('flash-sold-fill');
const track = () => screen.getByTestId('flash-sold-track');

describe('FlashSoldBar', () => {
  it.each([
    [0, 'Vừa mở bán'],
    [35, 'Đã bán 35%'],
    [68, 'Đã bán 68%'],
    [92, 'Sắp hết'],
  ])('%i%% hiện chữ "%s" và chữ nằm ngoài thanh aria-hidden', (pct, text) => {
    render(<FlashSoldBar soldPct={pct} />);
    const label = screen.getByText(text);
    expect(label).toBeVisible();
    expect(track().getAttribute('aria-hidden')).toBe('true');
    expect(track().contains(label)).toBe(false);
    expect(label.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('phần đã bán co giãn bằng scaleX theo phần trăm', () => {
    render(<FlashSoldBar soldPct={68} />);
    expect(fill()!.style.transform).toBe('scaleX(0.68)');
    expect(fill()!.style.transformOrigin).toBe('left');
  });

  // Chuyển động của phần đã bán nằm ở CSS (.tubu-flash-fill) chứ không inline, để cả hai app cùng một luật và web tắt được bằng
  // prefers-reduced-motion (Mini đã có luật toàn cục; web thì không, nên thanh web từng vẫn chạy 600ms khi khách chọn giảm chuyển động).
  it('phần đã bán là lớp tubu-flash-fill, không ghi transition inline; CSS gắn transform 600ms cho lớp đó', () => {
    render(<FlashSoldBar soldPct={68} />);
    expect(fill()!.className).toBe('tubu-flash-fill');
    expect(fill()!.style.transitionDuration).toBe('');
    expect(fill()!.style.transitionProperty).toBe('');
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    expect(css).toMatch(/\.tubu-flash-fill\s*\{[^}]*transition-property:\s*transform[^}]*transition-duration:\s*600ms/);
  });

  it('hết suất: chữ "Đã bán hết" thắng phần trăm, không phần cam', () => {
    render(<FlashSoldBar soldPct={10} soldOut />);
    expect(screen.getByText('Đã bán hết')).toBeVisible();
    expect(fill()).toBeNull();
    expect(screen.getByTestId('flash-sold-bar').getAttribute('data-state')).toBe('soldout');
  });

  it.each([
    [Number.NaN, 'scaleX(0)', 'Vừa mở bán'],
    [-5, 'scaleX(0)', 'Vừa mở bán'],
    [180, 'scaleX(1)', 'Sắp hết'],
    [100.4, 'scaleX(1)', 'Sắp hết'],
  ])('số rác %s: thanh kẹp 0–100 và chữ vẫn hiện', (pct, scale, text) => {
    render(<FlashSoldBar soldPct={pct} />);
    expect(fill()!.style.transform).toBe(scale);
    expect(screen.getByText(text)).toBeVisible();
  });
});
