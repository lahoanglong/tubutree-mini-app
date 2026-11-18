// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNLOCK_CELEBRATE_MS } from '@tubutree/app-core/commerce/freeship-progress';
import { CartUnlockSlot } from './cart-unlock-slot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const draw = (level: number, className?: string) =>
  act(() =>
    root.render(
      <CartUnlockSlot level={level} className={className}>
        x
      </CartUnlockSlot>,
    ),
  );
const slot = () => host.querySelector<HTMLElement>('[data-testid="cart-unlock"]')!;

describe('CartUnlockSlot (web, tubu-w3-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('lần vẽ đầu đã đạt: không mừng; giữ className của nơi gọi', () => {
    draw(1, 'mb-3');
    expect(slot().hasAttribute('data-celebrate')).toBe(false);
    expect(slot().className).toBe('tubu-unlock mb-3');
  });

  it('mức tăng: mừng một lần rồi tắt sau UNLOCK_CELEBRATE_MS; tụt rồi lên lại thì không mừng lần hai', () => {
    draw(0);
    draw(1);
    expect(slot().getAttribute('data-celebrate')).toBe('true');
    act(() => vi.advanceTimersByTime(UNLOCK_CELEBRATE_MS));
    expect(slot().hasAttribute('data-celebrate')).toBe(false);
    draw(0);
    draw(1);
    expect(slot().hasAttribute('data-celebrate')).toBe(false);
  });

  it('CSS (mini.css): dùng token chuyển động, tắt hẳn khi giảm chuyển động', () => {
    const css = readFileSync(resolve(__dirname, '../../mini/mini.css'), 'utf8');
    expect(css).toMatch(/\.tubu-unlock\[data-celebrate='true'\] > \.tubu-freeship \{ animation:[^;]*var\(--dur-slow\) var\(--ease-spring\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.tubu-unlock\[data-celebrate='true'\] > \.tubu-freeship \{ animation: none/);
  });
});
