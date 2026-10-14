import { useEffect } from 'react';
import { useScrollHints } from './use-scroll-hints';

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
}

/** Thay 5 kiểu tab khác nhau hiện tại (pill cam, TabChip, Button ZaUI đổi variant, Chip, Text-chip
 * — audit A4-19). role="tablist"/"tab" cho a11y (0 chỗ dùng hiện tại). */
export function SegmentedTabs({ items, value, onChange, scroll }: SegmentedTabsProps) {
  const hints = useScrollHints<HTMLDivElement>();
  useEffect(() => {
    if (!scroll) return;
    const active = hints.ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [scroll, value, hints.ref]);
  return (
    <div
      {...(scroll ? hints : {})}
      role="tablist"
      className={scroll ? 'scroll-x tubu-scroll-fade' : undefined}
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--stone-100)',
        borderRadius: 'var(--radius-control)',
        padding: 3,
      }}
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
            style={{
              flex: scroll ? '0 0 auto' : 1,
              minHeight: 44,
              minWidth: 44,
              border: 'none',
              borderRadius: 'var(--radius-control)',
              background: active ? 'var(--color-bg-surface)' : 'transparent',
              color: active ? 'var(--color-text-brand)' : 'var(--color-text-tertiary)',
              fontWeight: 600,
              fontSize: 'var(--type-body-sm-size)',
              boxShadow: active ? 'var(--elevation-1)' : 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              padding: '0 12px',
            }}
          >
            {it.label}
            {typeof it.count === 'number' && <span style={{ marginLeft: 4, opacity: 0.75 }}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
