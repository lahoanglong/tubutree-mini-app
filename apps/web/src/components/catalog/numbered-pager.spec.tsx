// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@/components/mini/harness';
import { NumberedPager } from './numbered-pager';

const hrefFor = (p: number) => `/ban-chay?page=${p}`;
const pager = (over: Partial<Parameters<typeof NumberedPager>[0]> = {}) =>
  mount(<NumberedPager hrefFor={hrefFor} startPage={1} lastPage={1} totalPages={7} hasNext {...over} />).container;

describe('NumberedPager', () => {
  it('điện thoại: liên kết Trang sau nằm trong HTML (crawler) nhưng ẩn khỏi mắt, hiện lại khi nhận focus và từ md', () => {
    const next = pager().querySelector<HTMLAnchorElement>('a[rel="next"]')!;
    expect(next.textContent).toContain('Trang sau');
    expect(next.getAttribute('href')).toBe('/ban-chay?page=2');
    const block = next.parentElement!;
    for (const cls of ['sr-only', 'focus-within:not-sr-only', 'md:not-sr-only', 'lg:hidden']) expect(block.className, cls).toContain(cls);
  });

  it('điện thoại: nav không đệm trên (phần số đã sr-only nên không còn dải trống), đệm lại từ md và khi bàn phím vào trong (H3 #4)', () => {
    const nav = pager().querySelector('nav')!;
    const classes = nav.className.split(/\s+/);
    expect(classes).not.toContain('pt-3');
    expect(classes).toContain('md:pt-3');
    expect(classes).toContain('focus-within:pt-3');
  });

  it('trang đầu không có liên kết Trang trước; trang sau có, trỏ về trang liền trước của danh sách đã tải', () => {
    expect(pager().querySelector('a[rel="prev"]')).toBeNull();
    const prev = pager({ startPage: 3, lastPage: 4 }).querySelector<HTMLAnchorElement>('a[rel="prev"]')!;
    expect(prev.getAttribute('href')).toBe('/ban-chay?page=2');
  });

  it('một trang duy nhất (không trang trước, không trang sau): không vẽ gì', () => {
    expect(pager({ hasNext: false }).querySelector('nav')).toBeNull();
  });

  it('từ lg: dãy số trang, trang đang xem có aria-current="page"', () => {
    const items = pager({ startPage: 1, lastPage: 2, totalPages: 7 }).querySelectorAll('ol a');
    expect(items.length).toBeGreaterThan(2);
    const current = [...items].filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe('2');
  });
});
