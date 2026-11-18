import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { GiftTrialRow } from './gift-rows';

const option = (variationId: string, minOrder: number, unlocked: boolean) => ({
  variationId,
  productName: `Khăn giấy tre ${variationId}`,
  variationName: 'Gói bỏ túi',
  slug: variationId,
  thumbnail: null,
  minOrder,
  unlocked,
});

const summary = (over: Partial<GiftTrialSummaryDTO> = {}): GiftTrialSummaryDTO => ({
  base: 320_000,
  minOrder: 299_000,
  nextMinOrder: 499_000,
  shortfall: 179_000,
  options: [option('nho', 299_000, true), option('lon', 499_000, false)],
  selectedVariationId: 'nho',
  declined: false,
  ...over,
});

describe('GiftTrialRow (Mini)', () => {
  it('không có khối quà thì không vẽ gì', () => {
    const { container } = render(<GiftTrialRow summary={undefined} showLocked onChoose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('chưa đủ mốc: Giỏ nhắc số còn thiếu không có nút; Thanh toán ẩn', () => {
    const locked = summary({ nextMinOrder: 299_000, shortfall: 45_000, selectedVariationId: null, options: [option('nho', 299_000, false)] });
    const { rerender, container } = render(<GiftTrialRow summary={locked} showLocked onChoose={() => {}} />);
    expect(screen.getByTestId('gift-trial-row').textContent).toContain('Thêm 45.000đ để nhận quà dùng thử 0đ');
    expect(screen.queryByTestId('gift-trial-change')).toBeNull();
    rerender(<GiftTrialRow summary={locked} showLocked={false} onChoose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('đổi quà trong tấm: chọn "Không nhận quà" gọi onChoose(null); quà chưa mở không chọn được', () => {
    const onChoose = vi.fn();
    render(<GiftTrialRow summary={summary()} showLocked={false} onChoose={onChoose} />);
    expect(screen.getByTestId('gift-trial-row').textContent).toContain('Quà 0đ: Khăn giấy tre nho · Gói bỏ túi');
    fireEvent.click(screen.getByTestId('gift-trial-change'));
    const rows = screen.getAllByTestId('gift-trial-option');
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(rows[1]!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(rows[1]!);
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(rows[2]!);
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('đang lưu thì nút Đổi khoá', () => {
    render(<GiftTrialRow summary={summary()} showLocked={false} busy onChoose={() => {}} />);
    expect((screen.getByTestId('gift-trial-change') as HTMLButtonElement).disabled).toBe(true);
  });
});
