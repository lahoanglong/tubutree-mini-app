'use client';

import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

const ITEM = '[role="radio"],[role="tab"]';

interface Options {
  /** `horizontal`: chỉ mũi tên trái/phải (tablist ngang). `both`: thêm lên/xuống (nhóm radio theo mẫu WAI-ARIA). */
  keys?: 'horizontal' | 'both';
}

const usable = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
const isSelected = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';

/**
 * Điều hướng mũi tên cho nhóm `role="radio"`/`role="tab"` (WAI-ARIA APG): một điểm dừng Tab (mục đang chọn, không có thì mục đầu còn dùng được),
 * mũi tên/Home/End chuyển focus và chọn mục đó bằng chính `click()` của nó nên luật chặn (mục khoá, đang chọn rồi) vẫn ở nơi gọi. Đi vòng ở hai đầu.
 * Gắn `ref` + `onKeyDown` lên phần tử `role="radiogroup"`/`role="tablist"`.
 * tabindex gắn thẳng lên DOM sau mỗi lần vẽ (chỗ gọi không phải tự tính theo mục đang chọn); trước khi hydrate mọi mục vẫn Tab được.
 */
export function useRovingGroup<T extends HTMLElement = HTMLDivElement>({ keys = 'both' }: Options = {}) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
    if (items.length === 0) return;
    const stop = items.find((el) => isSelected(el) && usable(el)) ?? items.find(usable);
    for (const el of items) el.tabIndex = el === stop ? 0 : -1;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const forward = e.key === 'ArrowRight' || (keys === 'both' && e.key === 'ArrowDown');
    const back = e.key === 'ArrowLeft' || (keys === 'both' && e.key === 'ArrowUp');
    const edge = e.key === 'Home' || e.key === 'End';
    if (!forward && !back && !edge) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? []).filter(usable);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || items.length === 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? items[0]! : e.key === 'End' ? items[items.length - 1]! : items[(at + (forward ? 1 : -1) + items.length) % items.length]!;
    next.focus();
    next.click();
  };

  return { ref, onKeyDown };
}
