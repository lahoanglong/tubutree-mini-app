// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

// Vỏ next/navigation có URL thật: router.replace đổi URL rồi báo cho useSearchParams như điều hướng mềm.
const nav = vi.hoisted(() => ({ search: '', replaces: [] as string[], listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/san-pham',
    useRouter: () => ({
      replace: (url: string) => {
        nav.replaces.push(url);
        nav.search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        nav.listeners.forEach((l) => l());
      },
    }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          (cb) => {
            nav.listeners.add(cb);
            return () => nav.listeners.delete(cb);
          },
          () => nav.search,
          () => nav.search,
        ),
      ),
  };
});

import { useBrowseState, type UseBrowseState } from './use-browse-state';
import { EMPTY_SEARCH_STATE } from './search-state';

let hook: UseBrowseState;
function Probe() {
  hook = useBrowseState();
  return null;
}
let mounted: Rendered | null = null;
const at = (search: string) => {
  nav.search = search;
  mounted = render(<Probe />);
};
beforeEach(() => {
  nav.replaces = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('useBrowseState', () => {
  it('đọc trạng thái từ URL, kể cả link cũ ?brand= / ?segment= và ?focus=search từ trang chủ', () => {
    at('brand=Tubu,M%E1%BB%99c%20An&segment=mom_baby&focus=search');
    expect(hook.state).toEqual({ ...EMPTY_SEARCH_STATE, brands: ['Tubu', 'Mộc An'], segment: 'mom_baby' });
    expect(hook.focusSearch).toBe(true);
    expect(hook.urlKey).toBe('segment=mom_baby&brand=Tubu%2CM%E1%BB%99c+An');
  });

  it('urlKey không đổi khi chỉ khác tham số lạ, focus hay page', () => {
    at('sort=newest&q=nuoc&utm=zalo&focus=search&page=3');
    const key = hook.urlKey;
    expect(key).toBe('q=nuoc&sort=newest');
    act(() => hook.consumeFocus());
    expect(hook.urlKey).toBe(key);
  });

  it('update ghi URL bằng replace, giữ phần còn lại, bỏ focus và page', () => {
    at('q=nuoc&focus=search&page=2');
    act(() => hook.update({ sort: 'best_seller' }));
    expect(nav.replaces).toEqual(['/san-pham?q=nuoc&sort=best_seller']);
  });

  it('update với undefined gỡ tham số; gỡ hết thì về đường dẫn trơn', () => {
    at('minPrice=100000&maxPrice=200000&inStock=1');
    act(() => hook.update({ minPrice: undefined, maxPrice: undefined }));
    expect(nav.replaces.at(-1)).toBe('/san-pham?inStock=1');
    act(() => hook.update({ inStock: false }));
    expect(nav.replaces.at(-1)).toBe('/san-pham');
  });

  it('giữ tham số lạ (utm, ref, s) theo thứ tự gốc, tham số chuẩn viết lại theo thứ tự cố định', () => {
    at('utm=zalo&sort=newest&q=nuoc&focus=search&ref=abc&s=ctv-an');
    act(() => hook.update({ inStock: true }));
    expect(nav.replaces.at(-1)).toBe('/san-pham?q=nuoc&inStock=1&sort=newest&utm=zalo&ref=abc&s=ctv-an');
  });

  it('làm sạch giá trị rác của tham số chuẩn', () => {
    at('sort=cheapest&q=nuoc');
    act(() => hook.update({ inStock: true }));
    expect(nav.replaces.at(-1)).toBe('/san-pham?q=nuoc&inStock=1');
  });

  it('consumeFocus chỉ bỏ focus, giữ tham số lạ', () => {
    at('q=nuoc&focus=search&utm=zalo');
    act(() => hook.consumeFocus());
    expect(nav.replaces.at(-1)).toBe('/san-pham?q=nuoc&utm=zalo');
    expect(hook.focusSearch).toBe(false);
  });

  it('hai update trong cùng một nhịp: cả hai patch còn trong URL, không lần nào đè lần nào', () => {
    at('q=nuoc&utm=zalo');
    act(() => {
      hook.update({ sort: 'newest' });
      hook.update({ inStock: true });
    });
    expect(nav.replaces.at(-1)).toBe('/san-pham?q=nuoc&inStock=1&sort=newest&utm=zalo');
    expect(hook.state).toMatchObject({ q: 'nuoc', sort: 'newest', inStock: true });
  });
});
