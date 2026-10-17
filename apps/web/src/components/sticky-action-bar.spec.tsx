// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { StickyActionBar } from './sticky-action-bar';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('StickyActionBar', () => {
  it('là vùng có tên, chỉ hiện dưới màn md, dính đáy và chừa safe-area', () => {
    const r = render(<StickyActionBar label="Mua hàng">nội dung</StickyActionBar>);
    mounted.push(r);
    const bar = r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Mua hàng');
    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.className).toMatch(/\bbottom-0\b/);
    expect(bar.className).toMatch(/\bmd:hidden\b/);
    expect(bar.style.paddingBottom).toContain('safe-area-inset-bottom');
    expect(bar.textContent).toBe('nội dung');
  });

  it('đánh dấu <body> trong lúc hiện để chân trang không bị thanh che, và gỡ khi rời trang', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    expect(document.body.classList.contains('has-sticky-bar')).toBe(true);
    r.unmount();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
  });
});
