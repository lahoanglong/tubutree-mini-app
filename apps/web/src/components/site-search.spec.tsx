// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, typeInto, type Rendered } from '@/test-utils/dom';
import { act } from 'react';
import { accessibleName, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// C-025 (A1-014): trang chủ web không có ô tìm kiếm trong khi API đã hỗ trợ GET /products?q=. Ô tìm kiếm nằm ở
// header (mọi trang khách) và đưa khách về trang chủ kèm ?q=.

const push = vi.hoisted(() => vi.fn());
// useSearchParams giả có thể đổi giữa chừng (như điều hướng mềm đổi ?q=) để kiểm ô nhập đồng bộ theo URL.
const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
}));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    useRouter: () => ({ push }),
    useSearchParams: () =>
      React.useSyncExternalStore(
        (cb) => {
          nav.listeners.add(cb);
          return () => nav.listeners.delete(cb);
        },
        () => nav.params,
        () => nav.params,
      ),
  };
});
const setUrlQuery = (qs: string) => {
  act(() => {
    nav.params = new URLSearchParams(qs);
    nav.listeners.forEach((l) => l());
  });
};

import SiteSearch from './site-search';

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<SiteSearch />);
  mounted.push(r);
  return r;
};
const submit = (container: HTMLElement) => {
  act(() => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  push.mockReset();
  nav.params = new URLSearchParams();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('SiteSearch', () => {
  it('vào thẳng /?q=... thì ô nhập hiện từ khoá đang tìm', () => {
    nav.params = new URLSearchParams('q=dầu gội');
    const { container } = mount();
    expect(container.querySelector('input')!.value).toBe('dầu gội');
  });

  it('URL đổi q (vd. bấm "Xóa tìm kiếm") thì ô nhập đổi theo, còn đang gõ dở thì không bị ghi đè', () => {
    nav.params = new URLSearchParams('q=dầu gội');
    const { container } = mount();
    const field = () => container.querySelector('input')!;
    typeInto(field(), 'dầu gội bồ kết');
    expect(field().value).toBe('dầu gội bồ kết');
    setUrlQuery('');
    expect(field().value).toBe('');
    setUrlQuery('q=xà phòng');
    expect(field().value).toBe('xà phòng');
  });


  it('là landmark tìm kiếm, ô nhập và nút có tên truy cập, vùng chạm 44px', () => {
    const { container } = mount();
    const form = container.querySelector('form')!;
    expect(form.getAttribute('role')).toBe('search');
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(accessibleName(input)).toBe('Tìm sản phẩm');
    expect(input.name).toBe('q');
    expect(input.maxLength).toBe(100);
    expect(accessibleName(container.querySelector('button[type="submit"]')!)).toBe('Tìm kiếm');
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('gửi: về trang chủ kèm từ khoá đã chuẩn hoá và neo danh sách sản phẩm', () => {
    const { container } = mount();
    typeInto(container.querySelector('input'), '  dầu   gội  ');
    submit(container);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(`/?${new URLSearchParams({ q: 'dầu gội' }).toString()}#san-pham`);
  });

  it('từ khoá rỗng hoặc chỉ có khoảng trắng: không điều hướng', () => {
    const { container } = mount();
    submit(container);
    typeInto(container.querySelector('input'), '   ');
    submit(container);
    expect(push).not.toHaveBeenCalled();
  });

  it('không có JS vẫn tìm được: form GET về trang chủ với tham số q', () => {
    const { container } = mount();
    const form = container.querySelector('form')!;
    expect(form.getAttribute('action')).toBe('/');
    expect(form.method).toBe('get');
  });
});
