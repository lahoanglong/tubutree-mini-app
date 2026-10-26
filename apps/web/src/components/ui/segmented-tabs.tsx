'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShellPathname } from '@/lib/shell-pathname';

export interface SegmentedTabItem {
  key: string;
  label: string;
  count?: number;
}

export interface SegmentedTabsProps {
  items: SegmentedTabItem[];
  value: string;
  onChange: (key: string) => void;
  scroll?: boolean;
  label?: string;
}

/** Tab dạng viên thuốc, cùng API với `SegmentedTabs` của Mini App. role tablist/tab, mũi tên trái/phải đổi tab. */
export function SegmentedTabs({ items, value, onChange, scroll, label }: SegmentedTabsProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scroll) return;
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [scroll, value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = items.findIndex((it) => it.key === value);
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.key);
    ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[items.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex gap-1 rounded-control bg-stone-100 p-[3px] ${scroll ? 'overflow-x-auto' : ''}`}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.key)}
            className={`min-h-11 min-w-11 whitespace-nowrap rounded-control px-3 text-sm font-semibold ${scroll ? 'shrink-0' : 'flex-1'} ${
              active ? 'bg-stone-0 text-forest-700 shadow-card' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {it.label}
            {typeof it.count === 'number' && <span className="ml-1 opacity-75">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tab đang chọn lưu trong `?tab=` để tải lại hay chia sẻ link vẫn đúng tab. Giá trị lạ hoặc thiếu rơi về `fallback`;
 * tab mặc định thì bỏ khỏi URL cho link gọn. Dùng `replace` để không chồng lịch sử khi đổi tab.
 */
export function useTabParam(keys: readonly string[], fallback: string): [string, (key: string) => void] {
  const router = useRouter();
  const pathname = useShellPathname();
  const params = useSearchParams();
  const raw = params?.get('tab') ?? '';
  const value = keys.includes(raw) ? raw : fallback;
  const set = useCallback(
    (key: string) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (key === fallback) next.delete('tab');
      else next.set('tab', key);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, fallback],
  );
  return [value, set];
}
