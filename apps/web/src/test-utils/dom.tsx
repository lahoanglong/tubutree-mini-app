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

export function render(ui: ReactElement, client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
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

/** Rời màn rồi quay lại trên CÙNG QueryClient: state và ref của component mất (khoá chạm bằng ref trống), bộ nhớ đệm và lượt nạp đang chạy còn. */
export function remount(r: Rendered, ui: ReactElement, client: QueryClient) {
  act(() => r.root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>));
  act(() => r.root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
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
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

/** Nút mở sheet của GeoPicker theo nhãn hiện trên màn hình (label htmlFor); `data-value` giữ mã đang chọn. */
export function selectByLabel(root: ParentNode, label: string): HTMLElement | null {
  const l = Array.from(root.querySelectorAll('label')).find((x) => x.textContent?.trim() === label);
  const el = l?.htmlFor ? document.getElementById(l.htmlFor) : null;
  return el instanceof HTMLElement ? el : null;
}

/**
 * Chọn một dòng trong sheet địa giới: mở sheet của ô `label` nếu chưa mở (chọn tỉnh xong sheet Phường/Xã tự mở),
 * rồi bấm dòng có mã (`data-code`) hoặc chữ khớp `optionText`.
 */
export function chooseGeo(root: ParentNode, label: string, optionText: string | RegExp) {
  const listbox = () => document.querySelector<HTMLElement>(`[role="listbox"][aria-label="${label}"]`);
  if (!listbox()) click(selectByLabel(root, label));
  const list = listbox();
  if (!list) throw new Error(`chooseGeo: sheet "${label}" không mở`);
  const opt = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find((o) =>
    typeof optionText === 'string' ? o.dataset.code === optionText || o.textContent?.trim() === optionText : optionText.test(o.textContent ?? ''),
  );
  if (!opt) throw new Error(`chooseGeo: không thấy dòng "${String(optionText)}" trong "${label}"`);
  click(opt);
}

export function selectValue(el: Element | null, value: string) {
  if (!el) throw new Error('selectValue: không thấy phần tử');
  act(() => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
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

/** Hộp thoại useConfirm render qua portal vào document.body, không nằm trong container của test. */
export function confirmDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

/** Gõ lý do vào ô nhập của hộp thoại `ask` đang mở rồi bấm Xác nhận. */
export function answerAsk(reason: string) {
  const d = confirmDialog();
  if (!d) throw new Error('answerAsk: không có hộp thoại đang mở');
  typeInto(d.querySelector('textarea'), reason);
  click(d.querySelector('[data-confirm="accept"]'));
}

/** Bấm "Xác nhận" (true) hoặc "Huỷ" (false) trên hộp thoại useConfirm đang mở. */
export function answerConfirm(accept: boolean) {
  const d = confirmDialog();
  if (!d) throw new Error('answerConfirm: không có hộp thoại xác nhận đang mở');
  click(d.querySelector(`[data-confirm="${accept ? 'accept' : 'cancel'}"]`));
}
