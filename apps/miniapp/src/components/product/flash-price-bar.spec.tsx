import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashPriceBar } from './flash-price-bar';
import { PdpBundleSlots } from './pdp-bundle-slots';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = { price: 84_000, compareAt: 120_000, pct: 30, soldPct: 40 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 1, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('FlashPriceBar', () => {
  it('giá deal màu cam đậm kèm giá gạch, -x%, đồng hồ chữ theo phút và thanh đã bán có chữ', () => {
    render(<FlashPriceBar {...base} endAt={iso(7_500_000)} />);
    expect(screen.getByText('Giờ vàng')).toBeInTheDocument();
    expect(screen.getByText('-30%')).toBeInTheDocument();
    expect(screen.getByText('84.000đ')).toHaveStyle({ color: 'var(--color-text-price-deal)' });
    expect(screen.getByText('120.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', 'Kết thúc sau 2 giờ 5 phút');
    expect(screen.getByRole('timer')).toHaveTextContent('Kết thúc sau 2 giờ 05 phút');
    expect(screen.getByText('Đã bán 40%')).toBeInTheDocument();
  });

  it('rãnh thanh đã bán dùng --color-track: nền thanh Giờ vàng đã là cam nhạt, rãnh cùng màu thì chữ "Đã bán" mất nền', () => {
    render(<FlashPriceBar {...base} endAt={iso(3_600_000)} />);
    expect(screen.getByTestId('flash-price-bar')).toHaveStyle({ background: 'var(--color-flash-bg)' });
    expect(screen.getByTestId('flash-sold-track')).toHaveStyle({ background: 'var(--color-track)' });
  });

  it('"Mỗi khách tối đa n" chỉ hiện khi API gửi giới hạn', () => {
    const { rerender } = render(<FlashPriceBar {...base} endAt={iso(3_600_000)} perUserLimit={5} />);
    expect(screen.getByText('Mỗi khách tối đa 5')).toBeInTheDocument();
    rerender(<FlashPriceBar {...base} endAt={iso(3_600_000)} perUserLimit={null} />);
    expect(screen.queryByText(/Mỗi khách tối đa/)).toBeNull();
  });

  it('hết giờ: gọi onEnd đúng một lần', () => {
    const onEnd = vi.fn();
    render(<FlashPriceBar {...base} endAt={iso(1_500)} onEnd={onEnd} />);
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('PdpBundleSlots (chỗ của P15)', () => {
  it('không render gì khi không có Combo lẫn Mua kèm', () => {
    const { container } = render(<PdpBundleSlots />);
    expect(container).toBeEmptyDOMElement();
  });

  it('có nội dung thì render đúng nội dung đó', () => {
    render(<PdpBundleSlots combos={<p>Combo X</p>} />);
    expect(screen.getByText('Combo X')).toBeInTheDocument();
  });
});
