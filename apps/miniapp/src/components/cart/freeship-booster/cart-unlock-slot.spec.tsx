import { act, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNLOCK_CELEBRATE_MS } from '@tubutree/app-core/commerce/freeship-progress';
import { CartUnlockSlot } from './cart-unlock-slot';

const slot = () => screen.getByTestId('cart-unlock');

describe('CartUnlockSlot (Mini, tubu-w3-02)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lần vẽ đầu đã đạt: không mừng', () => {
    render(<CartUnlockSlot level={1}>x</CartUnlockSlot>);
    expect(slot()).not.toHaveAttribute('data-celebrate');
    expect(slot()).toHaveClass('tubu-unlock');
  });

  it('mức tăng: mừng một lần rồi tắt sau UNLOCK_CELEBRATE_MS; tụt rồi lên lại thì không mừng lần hai; lên bậc cao hơn thì mừng tiếp', () => {
    const { rerender } = render(<CartUnlockSlot level={0}>x</CartUnlockSlot>);
    rerender(<CartUnlockSlot level={1}>x</CartUnlockSlot>);
    expect(slot()).toHaveAttribute('data-celebrate', 'true');
    act(() => vi.advanceTimersByTime(UNLOCK_CELEBRATE_MS));
    expect(slot()).not.toHaveAttribute('data-celebrate');
    rerender(<CartUnlockSlot level={0}>x</CartUnlockSlot>);
    rerender(<CartUnlockSlot level={1}>x</CartUnlockSlot>);
    expect(slot()).not.toHaveAttribute('data-celebrate');
    rerender(<CartUnlockSlot level={4}>x</CartUnlockSlot>);
    expect(slot()).toHaveAttribute('data-celebrate', 'true');
  });

  it('gỡ khung giữa chừng: không còn hẹn giờ treo', () => {
    const { rerender, unmount } = render(<CartUnlockSlot level={0}>x</CartUnlockSlot>);
    rerender(<CartUnlockSlot level={1}>x</CartUnlockSlot>);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CSS: dùng token chuyển động, tắt hẳn khi giảm chuyển động', () => {
    const css = readFileSync(resolve(__dirname, '../../../css/freeship.css'), 'utf8');
    expect(css).toMatch(/\.tubu-unlock\[data-celebrate='true'\] > \.tubu-freeship \{\s*animation:[^;]*var\(--dur-slow\) var\(--ease-spring\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.tubu-unlock\[data-celebrate='true'\] > \.tubu-freeship\s*\{\s*animation: none/);
  });
});
