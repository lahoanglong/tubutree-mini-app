// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from './harness';
import { FlashSoldBar } from './flash-sold-bar';

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const textOf = () => q('flash-sold-bar')!.textContent;

describe('FlashSoldBar (web)', () => {
  it.each([
    [0, 'Vừa mở bán'],
    [35, 'Đã bán 35%'],
    [68, 'Đã bán 68%'],
    [92, 'Sắp hết'],
  ])('%i%% hiện chữ "%s" ngoài thanh aria-hidden', (pct, text) => {
    mount(<FlashSoldBar soldPct={pct} />);
    expect(textOf()).toBe(text);
    expect(q('flash-sold-track')!.getAttribute('aria-hidden')).toBe('true');
    expect(q('flash-sold-track')!.textContent).toBe('');
  });

  it('phần đã bán co giãn bằng scaleX theo phần trăm', () => {
    mount(<FlashSoldBar soldPct={68} />);
    expect(q('flash-sold-fill')!.style.transform).toBe('scaleX(0.68)');
  });

  it('phần đã bán là lớp tubu-flash-fill, không ghi transition inline (để prefers-reduced-motion tắt được ở CSS)', () => {
    mount(<FlashSoldBar soldPct={68} />);
    expect(q('flash-sold-fill')!.className).toBe('tubu-flash-fill');
    expect(q('flash-sold-fill')!.style.transitionDuration).toBe('');
    expect(q('flash-sold-fill')!.style.transitionProperty).toBe('');
  });

  it('mặc định rãnh là nền cam nhạt; track="neutral" đổi sang --color-track để thấy được trên nền cam của thanh Giờ vàng', () => {
    mount(<FlashSoldBar soldPct={68} />);
    expect(q('flash-sold-track')!.style.background).toBe('var(--color-flash-bg)');
    mount(<FlashSoldBar soldPct={68} track="neutral" />);
    const tracks = document.querySelectorAll<HTMLElement>('[data-testid="flash-sold-track"]');
    expect(tracks[tracks.length - 1]!.style.background).toBe('var(--color-track)');
  });

  it('hết suất: "Đã bán hết" thắng phần trăm, không phần cam', () => {
    mount(<FlashSoldBar soldPct={10} soldOut />);
    expect(textOf()).toBe('Đã bán hết');
    expect(q('flash-sold-fill')).toBeNull();
    expect(q('flash-sold-bar')!.getAttribute('data-state')).toBe('soldout');
  });

  it.each([
    [Number.NaN, 'scaleX(0)', 'Vừa mở bán'],
    [-5, 'scaleX(0)', 'Vừa mở bán'],
    [180, 'scaleX(1)', 'Sắp hết'],
  ])('số rác %s: thanh kẹp 0–100 và chữ vẫn hiện', (pct, scale, text) => {
    mount(<FlashSoldBar soldPct={pct} />);
    expect(q('flash-sold-fill')!.style.transform).toBe(scale);
    expect(textOf()).toBe(text);
  });
});
