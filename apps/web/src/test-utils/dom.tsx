/**
 * Harness tối giản cho test component (vitest + jsdom, không thêm dependency testing-library):
 * render trong QueryClientProvider, gõ vào input có kiểm soát, bấm nút, chờ promise.
 * CHỈ dùng trong *.spec.tsx.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

export function render(ui: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Đợi các promise (fetch mock, mutation) chạy xong rồi React render lại. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export function typeInto(el: Element | null, value: string) {
  if (!el) throw new Error('typeInto: không thấy phần tử');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function click(el: Element | null) {
  if (!el) throw new Error('click: không thấy phần tử');
  act(() => {
    (el as HTMLElement).click();
  });
}

export function byText(root: ParentNode, selector: string, text: string | RegExp): HTMLElement | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return els.find((e) => (typeof text === 'string' ? e.textContent?.includes(text) : text.test(e.textContent ?? ''))) ?? null;
}

/** fetch giả: map theo đoạn URL → { status, body }. Ghi lại mọi lời gọi. */
export function mockFetch(routes: Record<string, { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown })>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ message: `no mock for ${url}` }), { status: 500 });
    const r = routes[key]!;
    const res = typeof r === 'function' ? r(init) : r;
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn, calls };
}
