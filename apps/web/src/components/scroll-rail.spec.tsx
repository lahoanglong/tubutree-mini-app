// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from '@/components/mini/harness';
import { ScrollRail } from './scroll-rail';

const sizes = { scrollWidth: 1000, clientWidth: 400 };
const proto = HTMLElement.prototype;
const orig = { sw: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'), cw: Object.getOwnPropertyDescriptor(proto, 'clientWidth') };

afterEach(() => {
  if (orig.sw) Object.defineProperty(proto, 'scrollWidth', orig.sw);
  if (orig.cw) Object.defineProperty(proto, 'clientWidth', orig.cw);
  else delete (proto as unknown as Record<string, unknown>).clientWidth;
});

function overflow() {
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => sizes.scrollWidth });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => sizes.clientWidth });
}

describe('ScrollRail', () => {
  it('hàng không tràn: không có nút ‹ ›', () => {
    const { container: c } = mount(
      <ScrollRail className="flex overflow-x-auto">
        <li>a</li>
      </ScrollRail>,
    );
    expect(c.querySelector('button')).toBeNull();
  });

  it('hàng tràn ở đầu: nút trước bị disabled, nút tiếp bật (cả hai ẩn ở điện thoại bằng class), bấm cuộn ngang bằng scrollBy', () => {
    overflow();
    const { container: c } = mount(
      <ScrollRail className="flex overflow-x-auto">
        <li>a</li>
      </ScrollRail>,
    );
    const next = c.querySelector('button[aria-label="Xem các mục tiếp"]') as HTMLButtonElement;
    expect(next).not.toBeNull();
    const prev = c.querySelector('button[aria-label="Xem các mục trước"]') as HTMLButtonElement;
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('false');
    expect(next.className).toMatch(/\bhidden\b/);
    expect(next.className).toMatch(/\bmd:flex\b/);
    // Hết đường thì ẩn hẳn khỏi mắt (đè mép thẻ đầu kệ), nhưng vẫn là nút aria-disabled hiện mờ lại khi focus bàn phím; nút còn đường không bị ẩn.
    for (const cls of ['aria-disabled:opacity-0', 'aria-disabled:pointer-events-none', 'aria-disabled:focus-visible:opacity-40']) expect(prev.className, cls).toContain(cls);
    expect(prev.className).not.toContain('aria-disabled:opacity-40');
    const ul = c.querySelector('ul') as HTMLUListElement;
    ul.scrollBy = vi.fn() as unknown as typeof ul.scrollBy;
    click(prev);
    expect(ul.scrollBy).not.toHaveBeenCalled();
    click(next);
    expect(ul.scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' });
  });

  it('cuộn tới cuối: nút tiếp thành aria-disabled, nút trước bật (nút nào hết đường thì nút đó ẩn)', () => {
    overflow();
    const { container: c } = mount(
      <ScrollRail className="flex overflow-x-auto">
        <li>a</li>
      </ScrollRail>,
    );
    const ul = c.querySelector('ul') as HTMLUListElement;
    Object.defineProperty(ul, 'scrollLeft', { configurable: true, value: sizes.scrollWidth - sizes.clientWidth });
    act(() => {
      ul.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const next = c.querySelector('button[aria-label="Xem các mục tiếp"]') as HTMLButtonElement;
    const prev = c.querySelector('button[aria-label="Xem các mục trước"]') as HTMLButtonElement;
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(prev.getAttribute('aria-disabled')).toBe('false');
  });
});
