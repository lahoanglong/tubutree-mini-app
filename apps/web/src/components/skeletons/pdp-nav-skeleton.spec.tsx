// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- thẻ a thuần để thử bộ lắng nghe bấm ở mức tài liệu */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const nav = vi.hoisted(() => ({ path: '/san-pham' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

import { PdpNavSkeleton } from './pdp-nav-skeleton';
import { announcePdpNavigation } from './pdp-nav-event';

const hasSkeleton = () => document.querySelector('[data-testid="pdp-nav-skeleton"]') !== null;
const link = (text: string) => ([...document.querySelectorAll('button')].find((n) => n.textContent === text) ?? [...document.querySelectorAll('a')].find((n) => n.textContent === text)) as HTMLElement;
function click(el: HTMLElement, init: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  });
}
function ui() {
  return (
    <>
      <PdpNavSkeleton />
      <a href="/san-pham/mat-ong">Mật ong</a>
      <a href="/san-pham/mat-ong" target="_blank">Tab mới</a>
      <a href="/gio-hang">Giỏ</a>
      <a href="/san-pham">Danh mục</a>
      <a href="https://example.com/san-pham/x">Ngoài</a>
      <a href="/san-pham/mat-ong">
        <button type="button">Tim</button>
      </a>
    </>
  );
}

let mounted: Rendered | null = null;
beforeEach(() => {
  nav.path = '/san-pham';
  vi.useFakeTimers();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('PdpNavSkeleton (R-83)', () => {
  it('bấm đường dẫn sản phẩm: khung chờ hiện ngay, trang mới về thì ẩn', () => {
    mounted = render(ui());
    expect(hasSkeleton()).toBe(false);
    click(link('Mật ong'));
    expect(hasSkeleton()).toBe(true);
    nav.path = '/san-pham/mat-ong';
    act(() => mounted!.root.render(ui()));
    expect(hasSkeleton()).toBe(false);
  });

  it('không hiện khi bấm link khác, tab mới, link ngoài, nút lồng trong link hoặc phím bổ trợ', () => {
    mounted = render(ui());
    for (const name of ['Giỏ', 'Tab mới', 'Danh mục', 'Ngoài', 'Tim']) {
      click(link(name));
      expect(hasSkeleton()).toBe(false);
    }
    click(link('Mật ong'), { ctrlKey: true });
    expect(hasSkeleton()).toBe(false);
  });

  it('điều hướng không về thì tự ẩn sau thời gian chờ tối đa, không kẹt khung chờ', () => {
    mounted = render(ui());
    click(link('Mật ong'));
    expect(hasSkeleton()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(20100);
    });
    expect(hasSkeleton()).toBe(false);
  });

  it('mạng chậm: vẫn giữ khung chờ sau 8 giây', () => {
    mounted = render(ui());
    click(link('Mật ong'));
    act(() => {
      vi.advanceTimersByTime(8100);
    });
    expect(hasSkeleton()).toBe(true);
  });

  it('đường mở bằng router.push (gợi ý tìm kiếm, Mua lại) báo qua announcePdpNavigation: hiện khung, bỏ query', () => {
    mounted = render(ui());
    act(() => announcePdpNavigation('/san-pham/mat-ong?v=12'));
    expect(hasSkeleton()).toBe(true);
    nav.path = '/san-pham/mat-ong';
    act(() => mounted!.root.render(ui()));
    expect(hasSkeleton()).toBe(false);
  });

  it('announcePdpNavigation bỏ qua đường dẫn không phải sản phẩm', () => {
    mounted = render(ui());
    act(() => announcePdpNavigation('/gio-hang'));
    expect(hasSkeleton()).toBe(false);
  });

  it('khung phủ cả thanh đáy (z trên 40) và có hàng nhãn hàng như trang thật', () => {
    mounted = render(ui());
    click(link('Mật ong'));
    const el = document.querySelector('[data-testid="pdp-nav-skeleton"]') as HTMLElement;
    expect(el.className).toContain('z-50');
    expect(el.querySelectorAll('[data-skeleton]').length).toBe(6);
  });
});
