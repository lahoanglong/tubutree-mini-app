// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { pushRecentSearch } from '@/lib/recent-searches';

// Hộp gợi ý ở ô tìm thanh đầu web (wave tubu-w2-05 B): combobox theo WAI-ARIA APG, tiêu điểm luôn ở ô nhập.

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: http.get } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));

import SiteSearch from './site-search';

const CATEGORIES = [{ id: 'c-giat', parentId: null, name: 'Nước giặt', slug: 'nuoc-giat', image: null, sortOrder: 1, productCount: 4, children: [] }];
const ITEM = { slug: 'nuoc-giat-cam', name: 'Nước giặt hương Cam', thumbnail: null, basePrice: 65000 };

let fetchMock: ReturnType<typeof vi.fn>;
let popular: string[];
let mounted: Rendered | null = null;

const mount = () => {
  mounted = render(<SiteSearch />);
  return mounted.container;
};
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
};
const options = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="option"]')];
const optionText = (c: HTMLElement) => options(c).map((o) => o.textContent);
/** Chờ quá 150 ms debounce rồi cho fetch giả trả về. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  await flush(4);
};
const focus = async (el: HTMLInputElement) => {
  act(() => el.focus());
  await flush(3);
};

beforeEach(() => {
  push.mockReset();
  localStorage.clear();
  popular = ['nước rửa chén', 'rửa tay'];
  http.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/categories') return CATEGORIES;
    if (path === '/search/popular') return { terms: popular };
    throw new Error(`đường dẫn lạ ${path}`);
  });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [ITEM], corrected: false, didYouMean: null }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe('SiteSearch — hộp gợi ý (combobox)', () => {
  it('ô trống: bấm vào mở hộp với Tìm gần đây rồi Tìm phổ biến (bỏ cụm trùng); ARIA đúng mẫu combobox', async () => {
    pushRecentSearch('rửa tay');
    const c = mount();
    const el = input(c);
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.hasAttribute('aria-controls')).toBe(false);
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    await focus(el);
    expect(el.getAttribute('aria-expanded')).toBe('true');
    const listbox = c.querySelector('[role="listbox"]')!;
    expect(el.getAttribute('aria-controls')).toBe(listbox.id);
    expect([...listbox.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Tìm gần đây', 'Tìm phổ biến']);
    expect(optionText(c)).toEqual(['rửa tay', 'nước rửa chén']);
    expect(http.get).toHaveBeenCalledWith('/search/popular', { anonymous: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('↓/↑ vòng qua các dòng qua aria-activedescendant, tiêu điểm ở lại ô; Enter mở dòng đang chọn', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    expect(optionText(c)).toEqual(['nước rửa chén', 'rửa tay']);
    expect(key(el, 'ArrowDown').defaultPrevented).toBe(true);
    expect(el.getAttribute('aria-activedescendant')).toBe(options(c)[0]!.id);
    expect(options(c)[0]!.getAttribute('aria-selected')).toBe('true');
    key(el, 'ArrowDown');
    key(el, 'ArrowDown');
    expect(el.getAttribute('aria-activedescendant')).toBe(options(c)[0]!.id);
    key(el, 'ArrowUp');
    expect(el.getAttribute('aria-activedescendant')).toBe(options(c)[1]!.id);
    expect(document.activeElement).toBe(el);
    key(el, 'Enter');
    expect(push).toHaveBeenCalledWith(`/san-pham?${new URLSearchParams({ q: 'rửa tay' })}`);
    expect(el.getAttribute('aria-expanded')).toBe('false');
  });

  it('gõ 2 ký tự trở lên: sau debounce gọi /search/suggest?meta=1 không kèm cookie; dòng "Tìm …", danh mục khớp, sản phẩm', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'n');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    typeInto(el, 'nuoc giat');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/search/suggest?q=nuoc%20giat&meta=1');
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(optionText(c)[0]).toBe('Tìm “nuoc giat”');
    expect(optionText(c)[1]).toBe('Nước giặt');
    expect(optionText(c)[2]).toContain('Nước giặt hương Cam');
    expect([...c.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Danh mục', 'Sản phẩm']);
  });

  it('Enter khi chưa chọn dòng: gửi đúng chữ đang gõ; chọn dòng sản phẩm: sang trang sản phẩm', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'nuoc giat');
    await settle();
    key(el, 'ArrowUp');
    key(el, 'Enter');
    expect(push).toHaveBeenLastCalledWith('/san-pham/nuoc-giat-cam');
    typeInto(el, 'nuoc giat');
    await settle();
    act(() => {
      c.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(push).toHaveBeenLastCalledWith(`/san-pham?${new URLSearchParams({ q: 'nuoc giat' })}`);
  });

  it('Esc đóng hộp, tiêu điểm vẫn ở ô; Esc lần nữa không chặn phím; ↓ mở lại ở dòng đầu', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    expect(key(el, 'Escape').defaultPrevented).toBe(true);
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(el);
    expect(key(el, 'Escape').defaultPrevented).toBe(false);
    key(el, 'ArrowDown');
    await flush(3);
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.getAttribute('aria-activedescendant')).toBe(options(c)[0]!.id);
  });

  it('đang gõ dấu bằng bộ gõ (isComposing): Enter không điều hướng', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    key(el, 'ArrowDown');
    key(el, 'Enter', { isComposing: true });
    expect(push).not.toHaveBeenCalled();
    expect(el.getAttribute('aria-expanded')).toBe('true');
  });

  it('chuột: nhấn trong hộp không lấy tiêu điểm (mousedown bị chặn); bấm dòng danh mục mở danh mục; bấm ngoài đóng hộp', async () => {
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'giat');
    await settle();
    const panel = c.querySelector<HTMLElement>('[data-testid="site-search-panel"]')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      panel.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    act(() => options(c)[1]!.click());
    expect(push).toHaveBeenCalledWith('/san-pham?category=c-giat');
    expect(document.activeElement).toBe(el);
    typeInto(el, 'nuoc giat');
    await settle();
    expect(c.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(c.querySelector('[role="listbox"]')).toBeNull();
  });

  it('API đã sửa từ khoá: nhóm sản phẩm đổi tiêu đề thành "Đang hiện kết quả cho …"', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [ITEM], corrected: true, didYouMean: 'nước giặt' }), { status: 200 }));
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'nuoc gait');
    await settle();
    const groups = [...c.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toContain('Đang hiện kết quả cho "nước giặt"');
  });

  it('API cũ trả mảng: vẫn đọc được; lỗi mạng: báo "Không tải được gợi ý" kèm Thử lại', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify([ITEM]), { status: 200 }));
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'nuoc giat');
    await settle();
    expect(optionText(c).some((t) => t?.includes('Nước giặt hương Cam'))).toBe(true);
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    typeInto(el, 'xa phong');
    await settle();
    const status = c.querySelector('[data-testid="site-search-panel"] [role="status"]');
    expect(status?.textContent).toContain('Không tải được gợi ý');
    expect(status?.querySelector('button')?.textContent).toBe('Thử lại');
  });

  it('từ khoá đổi khi yêu cầu cũ còn chạy: yêu cầu cũ bị huỷ (AbortSignal)', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise<Response>(() => {});
    });
    const c = mount();
    const el = input(c);
    await focus(el);
    typeInto(el, 'nuoc');
    await settle();
    typeInto(el, 'nuoc giat');
    await settle();
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });
});
