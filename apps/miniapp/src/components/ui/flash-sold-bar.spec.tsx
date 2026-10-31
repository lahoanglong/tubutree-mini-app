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
