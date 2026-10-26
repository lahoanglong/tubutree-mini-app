// @vitest-environment jsdom
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

  it('hàng tràn ở đầu: chỉ có nút tiếp (ẩn ở điện thoại bằng class), bấm cuộn ngang bằng scrollBy', () => {
    overflow();
    const { container: c } = mount(
      <ScrollRail className="flex overflow-x-auto">
        <li>a</li>
      </ScrollRail>,
    );
    const next = c.querySelector('button[aria-label="Xem các mục tiếp"]') as HTMLButtonElement;
    expect(next).not.toBeNull();
    expect(c.querySelector('button[aria-label="Xem các mục trước"]')).toBeNull();
    expect(next.className).toMatch(/\bhidden\b/);
    expect(next.className).toMatch(/\bmd:flex\b/);
    const ul = c.querySelector('ul') as HTMLUListElement;
    ul.scrollBy = vi.fn() as unknown as typeof ul.scrollBy;
    click(next);
    expect(ul.scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' });
  });
});
