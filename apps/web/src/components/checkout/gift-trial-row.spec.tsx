// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
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

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  for (const r of mounted) r.unmount();
  mounted = [];
});

describe('GiftTrialRow (web)', () => {
  it('chưa đủ mốc: Giỏ nhắc số còn thiếu không có nút; Thanh toán ẩn', () => {
    const locked = summary({ nextMinOrder: 299_000, shortfall: 45_000, selectedVariationId: null, options: [option('nho', 299_000, false)] });
    const cart = mount(<GiftTrialRow summary={locked} showLocked onChoose={() => {}} />);
    expect(cart.querySelector('[data-testid="gift-trial-row"]')!.textContent).toContain('Thêm 45.000đ để nhận quà dùng thử 0đ');
    expect(cart.querySelector('[data-testid="gift-trial-change"]')).toBeNull();
    expect(mount(<GiftTrialRow summary={locked} showLocked={false} onChoose={() => {}} />).innerHTML).toBe('');
  });

  it('đổi quà trong tấm: radio gốc, quà chưa mở bị khoá, "Không nhận quà" gọi onChoose(null)', () => {
    const onChoose = vi.fn();
    const c = mount(<GiftTrialRow summary={summary()} showLocked={false} onChoose={onChoose} />);
    expect(c.querySelector('[data-testid="gift-trial-row"]')!.textContent).toContain('Quà 0đ: Khăn giấy tre nho · Gói bỏ túi');
    act(() => c.querySelector<HTMLButtonElement>('[data-testid="gift-trial-change"]')!.click());
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="gift-trial-option"] input[type="radio"]'));
    expect(radios.map((r) => [r.checked, r.disabled])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    act(() => radios[2]!.click());
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('bàn phím: mũi tên chỉ dời focus, không lưu và không đóng tấm; Space (click sau keyup) mới chọn', () => {
    const onChoose = vi.fn();
    const c = mount(<GiftTrialRow summary={summary()} showLocked={false} onChoose={onChoose} />);
    act(() => c.querySelector<HTMLButtonElement>('[data-testid="gift-trial-change"]')!.click());
    const radios = () => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="gift-trial-option"] input[type="radio"]'));
    const key = (type: 'keydown' | 'keyup', key: string) => radios()[0]!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    act(() => {
      key('keydown', 'ArrowDown');
      radios()[2]!.click();
    });
    expect(onChoose).not.toHaveBeenCalled();
    expect(radios().map((r) => r.checked)).toEqual([true, false, false]);
    act(() => key('keyup', 'ArrowDown'));
    act(() => radios()[2]!.click());
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('đang lưu thì nút Đổi khoá', () => {
    const c = mount(<GiftTrialRow summary={summary()} showLocked={false} busy onChoose={() => {}} />);
    expect(c.querySelector<HTMLButtonElement>('[data-testid="gift-trial-change"]')!.disabled).toBe(true);
  });
});
