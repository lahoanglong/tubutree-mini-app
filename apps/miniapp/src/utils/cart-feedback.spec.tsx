import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_FLY_MS } from '@tubutree/app-core/commerce/cart-feedback';
import { CartBadge, CountBadge } from '../components/ui/cart-badge';
import { firstMeasurable, playCartFeedback } from './cart-feedback';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const place = (el: Element, r: DOMRect) => {
  el.getBoundingClientRect = () => r;
};
function setReducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('prefers-reduced-motion'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
}

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

describe('playCartFeedback (Mini App)', () => {
  it('chấm bay từ tâm nút tới tâm giỏ rồi tự gỡ', () => {
    const { source } = scene();
    playCartFeedback(source);
    const dot = document.querySelector<HTMLElement>('[data-cart-fly]');
    expect(dot).not.toBeNull();
    expect(dot!.style.left).toBe('150px');
    expect(dot!.style.top).toBe('614px');
    const [frames, options] = animate.mock.calls[0]!;
    expect(options).toMatchObject({ duration: CART_FLY_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    expect(frames[2].transform).toContain('translate3d(182px, -594px, 0)');
    finish!();
    expect(document.querySelector('[data-cart-fly]')).toBeNull();
  });

  it('giảm chuyển động: không bay; không thấy giỏ: không bay; không có animate: không lỗi', () => {
    setReducedMotion(true);
    const a = scene();
    playCartFeedback(a.source);
    expect(animate).not.toHaveBeenCalled();
    setReducedMotion(false);
    place(a.target, rect(0, 0, 0, 0));
    playCartFeedback(a.source);
    expect(animate).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    place(a.target, rect(320, 8, 44, 44));
    expect(() => playCartFeedback(a.source)).not.toThrow();
  });

  it('firstMeasurable bỏ bản đo ra 0×0', () => {
    const hidden = document.createElement('a');
    const shown = document.createElement('a');
    shown.className = 'shown';
    for (const el of [hidden, shown]) el.setAttribute('data-cart-target', '');
    place(hidden, rect(0, 0, 0, 0));
    place(shown, rect(1, 1, 44, 44));
    document.body.append(hidden, shown);
    expect(firstMeasurable('[data-cart-target]')?.className).toBe('shown');
  });
});

describe('huy hiệu giỏ nảy (Mini App)', () => {
  it('CartBadge nảy mỗi lần thêm vào giỏ và dựng lại để chạy lại nhịp', () => {
    render(<CartBadge count={2} />);
    const first = screen.getByLabelText('2 sản phẩm trong giỏ');
    expect(first.className).toBe('');
    act(() => playCartFeedback(null));
    const second = screen.getByLabelText('2 sản phẩm trong giỏ');
    expect(second.className).toBe('cart-badge-bump');
    expect(second).not.toBe(first);
    act(() => playCartFeedback(null));
    expect(screen.getByLabelText('2 sản phẩm trong giỏ')).not.toBe(second);
  });

  it('món đầu tiên (giỏ rỗng → 1): huy hiệu hiện ra đang nảy', () => {
    let setCount: (n: number) => void = () => {};
    function Cart() {
      const [c, set] = useState(0);
      setCount = set;
      return <CartBadge count={c} />;
    }
    const { container } = render(<Cart />);
    expect(container).toBeEmptyDOMElement();
    act(() => playCartFeedback(null));
    act(() => setCount(1));
    expect(screen.getByLabelText('1 sản phẩm trong giỏ').className).toBe('cart-badge-bump');
  });

  it('huy hiệu đơn hàng/chuông (không bump) không nảy theo giỏ', () => {
    render(<CountBadge count={3} label="3 đơn" />);
    act(() => playCartFeedback(null));
    expect(screen.getByLabelText('3 đơn').className).toBe('');
  });
});

describe('CSS và đồng bộ với web', () => {
  const tokens = readFileSync(join(__dirname, '../css/tokens.css'), 'utf8');
  it('nhịp nảy 220ms theo đường cong drawer, chỉ đổi transform; giảm chuyển động tắt hẳn', () => {
    expect(/\.cart-badge-bump\s*\{([^}]*)\}/.exec(tokens)?.[1]).toMatch(/animation:\s*cart-badge-bump 220ms var\(--ease-drawer,\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)\)/);
    const frames = /@keyframes cart-badge-bump\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
    expect(frames).toMatch(/transform:\s*scale\(1\.3\)/);
    expect(frames).not.toMatch(/(width|height|margin|top|left)\s*:/);
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cart-badge-bump\s*\{\s*animation:\s*none/);
  });

  it('cart-feedback.ts của Mini và web giống nhau (chỉ khác dòng ghi chú trỏ sang file kia)', () => {
    const body = (p: string) => readFileSync(join(__dirname, p), 'utf8').replace(/^\/\/ Cùng nội dung với .*\n/m, '');
    expect(body('./cart-feedback.ts')).toBe(body('../../../web/src/lib/cart-feedback.ts'));
  });
});
