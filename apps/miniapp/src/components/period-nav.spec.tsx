import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PeriodNav } from './period-nav';

function setup() {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  render(<PeriodNav label="Tháng 3/2026" prevLabel="Tháng trước" nextLabel="Tháng sau" onPrev={onPrev} onNext={onNext} />);
  return { onPrev, onNext };
}

describe('PeriodNav (thanh chuyển tháng/tuần)', () => {
  it('hai nút có tên, cao >= 44px, gọi đúng hướng', () => {
    const { onPrev, onNext } = setup();
    const prev = screen.getByRole('button', { name: 'Tháng trước' });
    const next = screen.getByRole('button', { name: 'Tháng sau' });
    expect(prev.style.minHeight).toBe('44px');
    expect(next.style.minHeight).toBe('44px');
    fireEvent.click(prev);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('nhãn kỳ nằm trong vùng aria-live lịch sự để trình đọc màn hình báo kỳ mới', () => {
    setup();
    expect(screen.getByText('Tháng 3/2026').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });
});
