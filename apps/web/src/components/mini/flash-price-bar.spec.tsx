// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { FlashPriceBar } from './flash-price-bar';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = { price: 84_000, compareAt: 120_000, pct: 30, soldPct: 40 };
let r: Rendered | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 1, 12, 0, 0));
});
afterEach(() => {
  r?.unmount();
  r = null;
  vi.useRealTimers();
});

describe('FlashPriceBar (web)', () => {
  it('giá deal kèm giá gạch, -x%, đồng hồ chữ theo phút và thanh đã bán có chữ', () => {
    r = render(<FlashPriceBar {...base} endAt={iso(7_500_000)} />);
    const text = r.container.textContent ?? '';
    expect(text).toContain('Giờ vàng');
    expect(text).toContain('-30%');
    expect(text).toContain('84.000đ');
    expect(text).toContain('120.000đ');
    expect(r.container.querySelector('[role="timer"]')!.textContent).toContain('Kết thúc sau 2 giờ 05 phút');
    expect(text).toContain('Đã bán 40%');
  });

  it('rãnh thanh đã bán dùng --color-track: nền thanh Giờ vàng đã là cam nhạt, rãnh cùng màu thì chữ "Đã bán" mất nền', () => {
    r = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} />);
    expect(r.container.querySelector<HTMLElement>('[data-testid="flash-price-bar"]')!.style.background).toBe('var(--color-flash-bg)');
    expect(r.container.querySelector<HTMLElement>('[data-testid="flash-sold-track"]')!.style.background).toBe('var(--color-track)');
  });

  it('className ở gốc và priceRowClassName ở dòng giá để trang web bo góc dải và ẩn giá lặp ở máy tính; không truyền thì không thêm lớp nào', () => {
    r = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} />);
    expect(r.container.querySelector('[data-testid="flash-price-bar"]')!.className).toBe('');
    expect(r.container.querySelector('[data-testid="flash-price-row"]')!.className).toBe('');
    r.unmount();
    r = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} className="md:rounded-sheet" priceRowClassName="lg:hidden" />);
    expect(r.container.querySelector('[data-testid="flash-price-bar"]')!.className).toBe('md:rounded-sheet');
    const row = r.container.querySelector('[data-testid="flash-price-row"]')!;
    expect(row.className).toBe('lg:hidden');
    expect(row.textContent).toContain('84.000đ');
  });

  it('"Mỗi khách tối đa n" chỉ hiện khi API gửi giới hạn', () => {
    r = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} perUserLimit={5} />);
    expect(r.container.textContent).toContain('Mỗi khách tối đa 5');
    r.unmount();
    r = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} />);
    expect(r.container.textContent).not.toContain('Mỗi khách tối đa');
  });

  it('hết giờ: gọi onEnd đúng một lần', () => {
    const onEnd = vi.fn();
    r = render(<FlashPriceBar {...base} endAt={iso(1_500)} onEnd={onEnd} />);
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
