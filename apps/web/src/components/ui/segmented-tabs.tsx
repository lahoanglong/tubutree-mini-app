'use client';

import { useCallback, useEffect, type MutableRefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShellPathname } from '@/lib/shell-pathname';
import { useScrollHints } from '@/components/mini/use-scroll-hints';
import { useRovingGroup } from '@/lib/use-roving-group';

export interface SegmentedTabItem {
  key: string;
  label: string;
  count?: number | string;
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
  const { ref, ...hintProps } = useScrollHints<HTMLDivElement>();
  useEffect(() => {
    if (!scroll) return;
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [ref, scroll, value]);

  const roving = useRovingGroup({ keys: 'horizontal' });
  const setRefs = (el: HTMLDivElement | null) => {
    (ref as MutableRefObject<HTMLDivElement | null>).current = el;
    (roving.ref as MutableRefObject<HTMLDivElement | null>).current = el;
  };

  return (
    <div
      ref={setRefs}
      {...(scroll ? hintProps : {})}
      role="tablist"
      aria-label={label}
      onKeyDown={roving.onKeyDown}
      className={`flex gap-1 rounded-control bg-stone-100 p-[3px] ${scroll ? 'tubu-scroll-fade overflow-x-auto' : ''}`}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`min-h-11 min-w-11 whitespace-nowrap rounded-control px-3 text-sm font-semibold ${scroll ? 'shrink-0' : 'flex-1'} ${
              active ? 'bg-stone-0 text-forest-700 shadow-card' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {it.label}
            {(typeof it.count === 'number' || typeof it.count === 'string') && <span className="ml-1 tabular-nums opacity-75">{it.count}</span>}
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
