'use client';

// Nguồn: apps/miniapp/src/components/ui/slot-tabs.tsx
import { useRef, type CSSProperties } from 'react';
import { tabKeyTarget, type SlotTab } from '@tubutree/app-core/commerce/flash-slots';
import { fillCopy } from '@tubutree/app-core/shop-copy';

export interface SlotTabsProps {
  tabs: SlotTab[];
  /** Id của khung đang chọn. */
  value: string;
  onChange: (id: string) => void;
  /** Id của vùng nội dung (`role="tabpanel"`) mà dải tab điều khiển. */
  panelId: string;
}

/** Id của nút tab: vùng nội dung trỏ ngược lại bằng `aria-labelledby`. */
export const slotTabId = (id: string): string => `slot-tab-${id}`;

const TAB: CSSProperties = {
  flex: '1 0 auto',
  minWidth: 72,
  minHeight: 56,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  padding: '6px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  transitionProperty: 'color, box-shadow',
  transitionDuration: '150ms',
  transitionTimingFunction: 'ease-out',
};

/**
 * Dải tab khung giờ của trang Giờ vàng (mẫu tabs của APG): MỘT tab nằm trong thứ tự Tab (roving tabindex), mũi tên trái/phải quay vòng,
 * Home/End nhảy tới đầu cuối, đổi tab kéo theo tiêu điểm. Chọn tab theo phím chọn luôn (tự kích hoạt): nội dung chỉ là danh sách đã có sẵn,
 * không tải nặng. Tên đọc của tab là "12:00, đang diễn ra"; chữ nhìn thấy (giờ + chú thích) là cùng thông tin. Tab chọn gạch chân 3px bằng
 * token viền chọn: không dựa vào màu chữ một mình. Quá 5 tab thì dải cuộn ngang (app-core đã cắt còn 5).
 */
export function SlotTabs({ tabs, value, onChange, panelId }: SlotTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (tabs.length === 0) return null;
  // Giá trị không khớp tab nào (khung vừa hết giờ) thì tab đầu giữ chỗ trong thứ tự Tab để dải không mất lối vào bằng bàn phím.
  const selectedIndex = Math.max(0, tabs.findIndex((t) => t.id === value));
  return (
    <div
      role="tablist"
      aria-label={fillCopy('flash.tabsLabel')}
      style={{ display: 'flex', overflowX: 'auto', background: 'var(--color-bg-surface)', boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)' }}
    >
      {tabs.map((tab, i) => {
        const selected = i === selectedIndex && tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={slotTabId(tab.id)}
            aria-selected={selected}
            aria-controls={panelId}
            aria-label={tab.spoken}
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => {
              onChange(tab.id);
            }}
            onKeyDown={(e) => {
              const target = tabKeyTarget(e.key, i, tabs.length);
              if (target === null) return;
              e.preventDefault();
              onChange(tabs[target]!.id);
              refs.current[target]?.focus();
            }}
            style={{
              ...TAB,
              color: selected ? 'var(--color-text-brand)' : 'var(--color-text-secondary)',
              boxShadow: selected ? 'inset 0 -3px 0 var(--color-border-selected)' : undefined,
            }}
          >
            <span aria-hidden style={{ fontSize: 'var(--type-title-sm-size)', fontWeight: 700, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
              {tab.clock}
            </span>
            <span aria-hidden style={{ fontSize: 'var(--type-label-size)', fontWeight: 500, lineHeight: 1.25 }}>
              {tab.caption}
            </span>
          </button>
        );
      })}
    </div>
  );
}
