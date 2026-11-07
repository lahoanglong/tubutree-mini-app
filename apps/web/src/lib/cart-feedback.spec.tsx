// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_BUMP_MS, CART_FLY_MS } from '@tubutree/app-core/commerce/cart-feedback';
import { CountBadge } from '@/components/mini/badge';
import { render, type Rendered } from '@/test-utils/dom';
import { firstMeasurable, playCartFeedback } from './cart-feedback';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function place(el: Element, r: DOMRect) {
  el.getBoundingClientRect = () => r;
}

function setReducedMotion(on: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: on && q.includes('prefers-reduced-motion'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  );
}

let mounted: Rendered[] = [];
let animate: ReturnType<typeof vi.fn>;
let finish: (() => void) | undefined;

beforeEach(() => {
  setReducedMotion(false);
  finish = undefined;
  animate = vi.fn(() => {
    const anim: { onfinish: (() => void) | null; oncancel: (() => void) | null } = { onfinish: null, oncancel: null };
    finish = () => anim.onfinish?.();
    return anim;
  });
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
});

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

function scene() {
  const source = document.createElement('button');
  const target = document.createElement('a');
  target.setAttribute('data-cart-target', '');
  place(source, rect(100, 600, 120, 48));
  place(target, rect(320, 8, 44, 44));
  document.body.append(source, target);
  return { source, target };
}

describe('playCartFeedback', () => {
  it('luôn báo "vừa thêm" cho huy hiệu, kể cả không có nút nguồn', () => {
    const seen = vi.fn();
    window.addEventListener('tubu:cart-added', seen);
    playCartFeedback(null);
    window.removeEventListener('tubu:cart-added', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
  });

  it('có nút nguồn và biểu tượng giỏ: một chấm bay đi từ tâm nút tới tâm giỏ rồi tự gỡ', () => {
    const { source } = scene();
    playCartFeedback(source);
    const dot = document.querySelector<HTMLElement>('[data-cart-fly]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('aria-hidden')).toBe('true');
    expect(dot!.style.pointerEvents).toBe('none');
    // tâm nút (160, 624), chấm 20px
    expect(dot!.style.left).toBe('150px');
    expect(dot!.style.top).toBe('614px');
    const [frames, options] = animate.mock.calls[0]!;
    expect(options).toMatchObject({ duration: CART_FLY_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    // tới tâm giỏ (342, 30): dx 182, dy -594
    expect(frames[2].transform).toContain('translate3d(182px, -594px, 0)');
    finish!();
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
  });

  it('giảm chuyển động: không có chấm bay, huy hiệu vẫn được báo (CSS tắt nhịp nảy)', () => {
    setReducedMotion(true);
    const { source } = scene();
    const seen = vi.fn();
    window.addEventListener('tubu:cart-added', seen);
    playCartFeedback(source);
    window.removeEventListener('tubu:cart-added', seen);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('không thấy biểu tượng giỏ (ẩn, 0×0) thì không bay', () => {
    const { source, target } = scene();
    place(target, rect(0, 0, 0, 0));
    playCartFeedback(source);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
  });

  it('trình duyệt không có Element.animate thì bỏ qua êm, không ném lỗi', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const { source } = scene();
    expect(() => playCartFeedback(source)).not.toThrow();
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
  });
});

describe('firstMeasurable', () => {
  it('bỏ qua bản bị ẩn (header điện thoại và máy tính cùng có giỏ, chỉ một bản hiện)', () => {
    const hidden = document.createElement('a');
    const shown = document.createElement('a');
    hidden.className = 'hidden-one';
    shown.className = 'shown-one';
    for (const el of [hidden, shown]) el.setAttribute('data-cart-target', '');
    place(hidden, rect(0, 0, 0, 0));
    place(shown, rect(10, 10, 44, 44));
    document.body.append(hidden, shown);
    expect(firstMeasurable('[data-cart-target]')?.className).toBe('shown-one');
  });
});

describe('CountBadge bump', () => {
  const mount = (ui: Parameters<typeof render>[0]) => {
    const r = render(ui);
    mounted.push(r);
    return r;
  };
  const badge = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="count-badge"]');

  it('có bump: nảy khi vừa thêm vào giỏ, mỗi lần thêm dựng lại để chạy lại nhịp', () => {
    const { container } = mount(<CountBadge count={2} bump />);
    expect(badge(container)!.className).toBe('');
    const first = badge(container)!;
    act(() => playCartFeedback(null));
    expect(badge(container)!.className).toBe('cart-badge-bump');
    expect(badge(container)).not.toBe(first);
    const second = badge(container)!;
    act(() => playCartFeedback(null));
    expect(badge(container)!.className).toBe('cart-badge-bump');
    expect(badge(container)).not.toBe(second);
  });

  it('thêm món đầu tiên (giỏ rỗng → 1): huy hiệu hiện ra với nhịp nảy', () => {
    let setCount: (n: number) => void = () => {};
    function Cart() {
      const [count, set] = useState(0);
      setCount = set;
      return <CountBadge count={count} bump />;
    }
    const { container } = mount(<Cart />);
    expect(badge(container)).toBeNull();
    act(() => playCartFeedback(null));
    act(() => setCount(1));
    expect(badge(container)!.className).toBe('cart-badge-bump');
    expect(badge(container)!.textContent).toBe('1');
  });

  it('không có bump (huy hiệu đơn hàng, chuông): không nảy theo giỏ', () => {
    const { container } = mount(<CountBadge count={2} />);
    act(() => playCartFeedback(null));
    expect(badge(container)!.className).toBe('');
  });
});

describe('CSS nhịp nảy huy hiệu giỏ', () => {
  const css = readFileSync(join(__dirname, '../components/mini/mini.css'), 'utf8');

  it(`${CART_BUMP_MS}ms theo đường cong drawer, chỉ đổi transform (không gây CLS)`, () => {
    const rule = /\.cart-badge-bump\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/animation:\s*cart-badge-bump 220ms var\(--ease-drawer,\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)\)/);
    const frames = /@keyframes cart-badge-bump\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(frames).toMatch(/transform:\s*scale\(1\.3\)/);
    expect(frames).not.toMatch(/(width|height|margin|top|left)\s*:/);
  });

  it('giảm chuyển động: tắt nhịp nảy', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cart-badge-bump\s*\{\s*animation:\s*none/);
  });
});
