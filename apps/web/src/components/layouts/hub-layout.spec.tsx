// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { HubLayout } from './hub-layout';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const part = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const wrapperOf = (c: HTMLElement, id: string) => part(c, id).parentElement!;
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('HubLayout — lưới 12 cột cho Trang chủ máy tính', () => {
  const full = () => (
    <HubLayout banner={<div data-testid="banner" />} aside={<div data-testid="aside" />}>
      <div data-testid="rest" />
    </HubLayout>
  );

  it('từ lg là lưới 12 cột cách 6: banner chiếm 8 cột bên trái, aside 4 cột bên phải cùng hàng, phần còn lại trải 12 cột bên dưới', () => {
    mounted = render(full());
    const c = mounted.container;
    const root = part(c, 'hub-layout');
    for (const cls of ['lg:grid', 'lg:grid-cols-12', 'lg:gap-6']) expect(root.className).toContain(cls);
    expect(wrapperOf(c, 'banner').className).toEqual(expect.stringContaining('lg:col-span-8'));
    expect(wrapperOf(c, 'banner').className).toEqual(expect.stringContaining('lg:col-start-1'));
    expect(wrapperOf(c, 'aside').className).toEqual(expect.stringContaining('lg:col-span-4'));
    expect(wrapperOf(c, 'aside').className).toEqual(expect.stringContaining('lg:col-start-9'));
    expect(wrapperOf(c, 'rest').className).toEqual(expect.stringContaining('lg:col-span-12'));
  });

  it('thứ tự DOM là thứ tự của Mini (aside rồi banner rồi phần còn lại) để điện thoại xếp đúng như Mini 375px; không dùng max-md', () => {
    mounted = render(full());
    const c = mounted.container;
    expect(follows(part(c, 'aside'), part(c, 'banner'))).toBe(true);
    expect(follows(part(c, 'banner'), part(c, 'rest'))).toBe(true);
    expect(c.innerHTML).not.toContain('max-md:');
  });

  it('dưới lg mọi khung bọc là display: contents (không thêm khung, bố cục như Mini)', () => {
    mounted = render(full());
    const c = mounted.container;
    for (const el of [part(c, 'hub-layout'), wrapperOf(c, 'banner'), wrapperOf(c, 'aside'), wrapperOf(c, 'rest')]) {
      expect(el.className.split(' ')[0]).toBe('contents');
      expect(el.className).toContain('lg:');
    }
  });

  it('không có banner: không vẽ khung banner và aside chiếm cả 12 cột', () => {
    mounted = render(
      <HubLayout aside={<div data-testid="aside" />}>
        <div data-testid="rest" />
      </HubLayout>,
    );
    const c = mounted.container;
    expect(c.querySelector('[data-testid="banner"]')).toBeNull();
    expect(wrapperOf(c, 'aside').className).toEqual(expect.stringContaining('lg:col-span-12'));
    expect(wrapperOf(c, 'aside').className).not.toContain('lg:col-span-4');
    expect(c.querySelectorAll('[data-hub-part="banner"]')).toHaveLength(0);
  });
});
